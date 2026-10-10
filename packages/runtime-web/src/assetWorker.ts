import { AtlasError } from '@limber/atlas';
import { compilePackedRuntime, encodeRuntime, RuntimeFormatError } from '@limber/runtime';
import { prepareEncodedAtlas } from './atlasPipeline';
import { nativeSourceImages } from './nativeSourceImages';
import { nativeSourceFonts } from './nativeSourceFonts';
import type { AtlasWorkerRequest, AtlasWorkerMessage } from './atlasProtocol';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AtlasWorkerRequest>) => void) | null;
  postMessage(message: AtlasWorkerMessage, transfer?: Transferable[]): void;
};
let accepted = false;
worker.onmessage = async ({ data }) => {
  // An export owns its worker. Never multiplex mutable WASM jobs in this instance.
  if (accepted || !data || !Number.isSafeInteger(data.id) || data.id < 1) return;
  accepted = true;
  const id = data.id;
  try {
    const fonts = data.input.project ? await nativeSourceFonts(data.input.project, data.input.fontSources,
      (fraction) => worker.postMessage({ id, kind: 'progress', fraction: fraction * 0.1, stage: 'fonts' })) : undefined;
    const project = fonts?.project;
    const input = project
      ? {
          ...data.input,
          images: nativeSourceImages(project),
          svgFonts: [...(data.input.svgFonts ?? []), ...(fonts?.buffers ?? [])],
          raster: {
            ...data.input.raster,
            // A minimal alpha box loses bilinear fringes when its sprite quad is trimmed.
            // Preserve at least one output texel's transparent sampling footprint.
            trimMargin: Math.max(
              data.input.raster?.trimMargin ?? 0,
              Math.min(16384, Math.ceil(1 / (data.input.raster?.scale ?? 1))),
            ),
          },
        }
      : data.input;
    const result = await prepareEncodedAtlas(input, (fraction, stage) =>
      worker.postMessage({
        id,
        kind: 'progress',
        fraction: project ? 0.1 + fraction * 0.75 : fraction,
        stage,
      }),
    );
    if (project) {
      worker.postMessage({ id, kind: 'progress', fraction: 0.9, stage: 'compile' });
      const start = performance.now();
      const regions = new Map(result.regions.map((region) => [region.id, region]));
      const base64 = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let text = '';
        for (let p = 0; p < bytes.length; p += 8192)
          text += String.fromCharCode(...bytes.subarray(p, p + 8192));
        return btoa(text);
      };
      const compilation = compilePackedRuntime(
        project,
        {
          textures: result.layout.placements.map((p) => {
            const r = regions.get(p.id)!;
            return {
              id: r.id,
              type: 'atlas',
              pageId: result.pages[p.page]!.id,
              sourceWidth: r.sourceWidth,
              sourceHeight: r.sourceHeight,
              crop: r.crop,
              frame: { x: p.x, y: p.y, width: p.width, height: p.height },
              rotated: p.rotated,
              scale: r.scale,
              empty: r.empty,
            };
          }),
          pages: result.pages.map((p) => ({
            id: p.id,
            width: p.width,
            height: p.height,
            mime: p.mime,
            base64: base64(p.bytes),
            padding: result.layout.padding,
            premultiplied: false,
          })),
        },
        data.input.runtimeOptions,
      );
      result.runtime = {
        bytes: encodeRuntime(compilation.program).buffer as ArrayBuffer,
        diagnostics: compilation.diagnostics,
        durationMs: performance.now() - start,
        fontDurationMs: fonts!.durationMs,
        projectId: compilation.program.id,
        defaultArtboardId: compilation.program.defaultArtboardId,
      };
      result.timingsMs.total += result.runtime.durationMs + result.runtime.fontDurationMs;
      worker.postMessage({ id, kind: 'progress', fraction: 1, stage: 'compile' });
    }
    worker.postMessage({ id, kind: 'result', result }, [
      ...result.pages.map((page) => page.bytes),
      ...(result.runtime ? [result.runtime.bytes] : []),
    ]);
  } catch (error) {
    const diagnostic =
      error instanceof RuntimeFormatError
        ? new AtlasError(
            error.diagnostic.code,
            error.diagnostic.objectId,
            error.message,
            error.diagnostic.remedy,
          )
        : error instanceof AtlasError
          ? error
          : new AtlasError(
              'ATLAS_WORKER_FAILURE',
              null,
              error instanceof Error ? error.message : 'Atlas worker failed.',
              'Correct the source assets/settings and retry.',
            );
    worker.postMessage({
      id,
      kind: 'error',
      code: diagnostic.code,
      objectId: diagnostic.objectId,
      message: diagnostic.message,
      remedy: diagnostic.remedy,
    });
  }
};
