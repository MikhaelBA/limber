import {
  ATLAS_MAX_PIXELS,
  ATLAS_MAX_REGIONS,
  validateAtlasLayout,
  validateImageSize,
  type AtlasLayout,
  type AtlasLayoutOptions,
  type AtlasRasterOptions,
  type AtlasRect,
  type AtlasWorkStats,
} from '@limber/atlas';
import { readRasterSize } from './imageHeader';
import type { BoneByBoneProject, EmbeddedFont } from '@limber/core';
import {
  loadRuntime,
  RUNTIME_MAX_BYTES,
  type CompileRuntimeOptions,
  type RuntimeDiagnostic,
} from '@limber/runtime';

export interface AtlasSourceImage {
  id: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  bytes: ArrayBuffer;
  trim?: boolean;
}
export interface NativeFontFetchSource extends Omit<EmbeddedFont, 'base64' | 'license'> {
  url: string;
  license: Omit<EmbeddedFont['license'], 'text'> & { text?: string; textUrl?: string };
}
export interface AtlasWorkerInput {
  images: AtlasSourceImage[];
  layout?: AtlasLayoutOptions;
  raster?: AtlasRasterOptions;
  /** Required only for SVG. The host bundler supplies a local resvg WASM asset URL. */
  wasmUrl?: string;
  /** Explicit SVG text fonts; no implicit OS font discovery in the worker. */
  svgFonts?: ArrayBuffer[];
  maxDecodedPixels?: number;
  /** Optional authoring snapshot: compile packed native bytes in this same owned worker. */
  project?: BoneByBoneProject;
  runtimeOptions?: CompileRuntimeOptions;
  /** Explicit host-bundled resources. Authored font bytes take precedence. */
  fontSources?: readonly NativeFontFetchSource[];
}
export interface AtlasRegionMetadata {
  id: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: AtlasRect;
  scale: number;
  empty: boolean;
  width: number;
  height: number;
}
export interface EncodedAtlasPage {
  id: string;
  width: number;
  height: number;
  mime: 'image/png';
  bytes: ArrayBuffer;
  premultiplied: false;
}
export interface AtlasWorkerResult {
  layout: AtlasLayout;
  regions: AtlasRegionMetadata[];
  pages: EncodedAtlasPage[];
  stats: AtlasWorkStats;
  timingsMs: {
    decode: number;
    prepare: number;
    pack: number;
    compose: number;
    encode: number;
    total: number;
  };
  runtime?: {
    bytes: ArrayBuffer;
    diagnostics: RuntimeDiagnostic[];
    durationMs: number;
    fontDurationMs: number;
    projectId: string;
    defaultArtboardId: string;
  };
}
export interface AtlasWorkerRequest {
  id: number;
  input: AtlasWorkerInput;
}
export type AtlasWorkerMessage =
  | {
      id: number;
      kind: 'progress';
      fraction: number;
      stage: 'fonts' | 'decode' | 'prepare' | 'pack' | 'compose' | 'encode' | 'compile';
    }
  | { id: number; kind: 'result'; result: AtlasWorkerResult }
  | { id: number; kind: 'error'; code: string; objectId: string | null; message: string; remedy: string };
export interface AtlasJobWorker {
  onmessage: ((event: MessageEvent<AtlasWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: AtlasWorkerRequest): void;
  terminate(): void;
}

/** Fail closed on detached worker messages without allocating decoded page pixels. */
export function validAtlasWorkerResult(value: unknown): value is AtlasWorkerResult {
  try {
    const r = value as AtlasWorkerResult;
    if (
      !r ||
      !Array.isArray(r.pages) ||
      r.pages.length > 64 ||
      !Array.isArray(r.regions) ||
      r.regions.length > ATLAS_MAX_REGIONS ||
      r.pages.length !== r.layout?.pages?.length
    )
      return false;
    validateAtlasLayout(r.regions, r.layout);
    let bytes = 0;
    for (const [index, page] of r.pages.entries()) {
      if (
        page.id !== `page-${index}` ||
        page.mime !== 'image/png' ||
        page.premultiplied !== false ||
        !(page.bytes instanceof ArrayBuffer) ||
        !page.bytes.byteLength
      )
        return false;
      bytes += page.bytes.byteLength;
      if (bytes > 128 * 1024 * 1024) return false;
      const size = readRasterSize(new Uint8Array(page.bytes), page.mime, page.id),
        layout = r.layout.pages[index]!;
      if (
        size.width !== page.width ||
        size.height !== page.height ||
        page.width !== layout.width ||
        page.height !== layout.height
      )
        return false;
    }
    let sources = 0;
    for (const region of r.regions) {
      validateImageSize({ id: region.id, width: region.sourceWidth, height: region.sourceHeight });
      sources += region.sourceWidth * region.sourceHeight;
      const c = region.crop;
      if (
        !c ||
        ![c.x, c.y, c.width, c.height].every(Number.isSafeInteger) ||
        c.x < 0 ||
        c.y < 0 ||
        c.width < 1 ||
        c.height < 1 ||
        c.x + c.width > region.sourceWidth ||
        c.y + c.height > region.sourceHeight ||
        !Number.isFinite(region.scale) ||
        region.scale <= 0 ||
        region.scale > 16 ||
        typeof region.empty !== 'boolean' ||
        region.width !== Math.ceil(c.width * region.scale) ||
        region.height !== Math.ceil(c.height * region.scale)
      )
        return false;
    }
    if (sources > ATLAS_MAX_PIXELS) return false;
    if (
      !r.stats ||
      !['fitTests', 'pruneTests', 'pixelsScanned', 'resizedPixels', 'compositedPixels'].every(
        (key) =>
          Number.isSafeInteger(r.stats[key as keyof AtlasWorkStats]) &&
          r.stats[key as keyof AtlasWorkStats] >= 0,
      )
    )
      return false;
    if (
      !r.timingsMs ||
      !['decode', 'prepare', 'pack', 'compose', 'encode', 'total'].every(
        (key) =>
          Number.isFinite(r.timingsMs[key as keyof AtlasWorkerResult['timingsMs']]) &&
          r.timingsMs[key as keyof AtlasWorkerResult['timingsMs']] >= 0,
      )
    )
      return false;
    if (r.runtime) {
      if (
        !(r.runtime.bytes instanceof ArrayBuffer) ||
        !r.runtime.bytes.byteLength ||
        r.runtime.bytes.byteLength > RUNTIME_MAX_BYTES ||
        !Number.isFinite(r.runtime.durationMs) ||
        r.runtime.durationMs < 0 ||
        !Number.isFinite(r.runtime.fontDurationMs) ||
        r.runtime.fontDurationMs < 0 ||
        !Array.isArray(r.runtime.diagnostics)
      )
        return false;
      const program = loadRuntime(new Uint8Array(r.runtime.bytes));
      if (program.id !== r.runtime.projectId || program.defaultArtboardId !== r.runtime.defaultArtboardId)
        return false;
      for (const d of r.runtime.diagnostics)
        if (
          !d ||
          typeof d.code !== 'string' ||
          !['error', 'warning'].includes(d.severity) ||
          !(d.objectId === null || typeof d.objectId === 'string') ||
          typeof d.explanation !== 'string' ||
          typeof d.remedy !== 'string'
        )
          return false;
    }
    return true;
  } catch {
    return false;
  }
}
