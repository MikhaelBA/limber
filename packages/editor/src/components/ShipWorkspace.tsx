import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeFontBytes } from '@limber/core';
import {
  NativeRuntimeAsset,
  RuntimeFormatError,
  RUNTIME_MAX_BYTES,
  RUNTIME_BUDGET_KEYS,
  createRuntimeBudget,
  validateRuntimeBudget,
  inspectRuntimeInventory,
  diagnoseNativeRigs,
  inspectRuntimeCompatibility,
  checkRuntimeBudget,
  loadRuntime,
  serializeRuntime,
  type RuntimeProgram,
  type RuntimeBudget,
  type RuntimeBudgetPreset,
  type RuntimeDiagnostic,
} from '@limber/runtime';
import { compileNativeProject } from '../engine/nativeAtlasJob';
import { textureRegistry } from '../engine/TextureRegistry';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';
import { captureProjectSnapshot, downloadProjectArtifact } from '../persistence/projectSnapshot';
import { readShipBudget, saveShipBudget } from '../persistence/shipSettings';
import { NativePreview, type NativePreviewHandle, type NativePreviewStatistics } from './NativePreview';
import { NativeLogicControls } from './NativeLogicControls';
import { ShipDoctorFindings } from './ShipDoctorFindings';
import { resolveShipFocus, type ShipFocusTarget } from '../persistence/shipFocus';

const button = 'rounded border border-neutral-600 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-40';
const field = 'w-full rounded border border-neutral-600 bg-neutral-900 p-1 text-xs';
const PREVIEW_SIZES: Record<string, { width: number; height: number } | undefined> = {
  authored: undefined,
  'phone-portrait': { width: 390, height: 844 },
  'phone-landscape': { width: 844, height: 390 },
  tablet: { width: 1024, height: 768 },
  desktop: { width: 1920, height: 1080 },
};
interface Publication {
  asset: NativeRuntimeAsset;
  program: RuntimeProgram;
  bytes: ArrayBuffer;
  kind: 'compiled' | 'loaded';
  compileDiagnostics: RuntimeDiagnostic[];
}
function finding(error: unknown): RuntimeDiagnostic {
  if (error instanceof RuntimeFormatError) return { ...error.diagnostic };
  const value = error as { code?: string; objectId?: string; remedy?: string; message?: string };
  return {
    code: typeof value?.code === 'string' ? value.code : 'SHIP_FAILED',
    severity: 'error',
    objectId: value?.objectId ?? null,
    explanation: value?.message ?? String(error),
    remedy: value?.remedy ?? 'Correct the indicated source/resource and prepare the export again.',
  };
}
const readable = (value: number | null | undefined) =>
  value === null || value === undefined
    ? 'Unmeasured'
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(2);

export function ShipWorkspace() {
  const engine = useEngine(),
    revision = useEditorStore((s) => s.dataRevision),
    setStatus = useEditorStore((s) => s.setStatus);
  const [restoredBudget] = useState(() => {
    try {
      return readShipBudget(localStorage);
    } catch {
      return {
        budget: createRuntimeBudget(),
        warning: 'Browser storage is unavailable. Web preset restored.',
      };
    }
  });
  const [budget, setBudget] = useState(restoredBudget.budget);
  const [focusTargets, setFocusTargets] = useState<ShipFocusTarget[]>([]);
  const [publication, setPublication] = useState<Publication | null>(null),
    [entryArtboardId, setEntryArtboardId] = useState(engine.project.artboards[0]!.id),
    [artboardId, setArtboardId] = useState(''),
    [inputOwner, setInputOwner] = useState(''),
    [viewportPreset, setViewportPreset] = useState('authored'),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState({ fraction: 0, stage: '' }),
    [error, setError] = useState<RuntimeDiagnostic | null>(null),
    [ready, setReady] = useState(false),
    [statistics, setStatistics] = useState<NativePreviewStatistics | null>(null),
    [pageIndex, setPageIndex] = useState(0),
    [focusedTexture, setFocusedTexture] = useState(''),
    [maxSize, setMaxSize] = useState(4096),
    [padding, setPadding] = useState(2),
    [scale, setScale] = useState(1),
    [trim, setTrim] = useState(true),
    [rotation, setRotation] = useState(true),
    [powerOfTwo, setPowerOfTwo] = useState(true);
  const handle = useRef<NativePreviewHandle | null>(null),
    job = useRef<AbortController | null>(null),
    epoch = useRef(0),
    chooser = useRef<HTMLInputElement>(null),
    atlasInspection = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    epoch.current++;
    job.current?.abort();
    setBusy(false);
    setPublication(null);
    setReady(false);
    setStatistics(null);
    setError(null);
    setFocusTargets([]);
    setEntryArtboardId((id) =>
      engine.project.artboards.some((board) => board.id === id) ? id : engine.project.artboards[0]!.id,
    );
    return () => {
      epoch.current++;
      job.current?.abort();
    };
  }, [revision]);
  const report = useMemo(
    () => (publication ? inspectRuntimeInventory(publication.asset, budget) : null),
    [publication, budget],
  );
  const rigFindings = useMemo(
    () => (publication ? diagnoseNativeRigs(publication.asset, budget) : []),
    [publication, budget],
  );
  const diagnostics = useMemo(() => {
    const all = [
      ...(report?.diagnostics ?? []),
      ...rigFindings,
      ...(publication?.compileDiagnostics ?? []),
      ...(error ? [error] : []),
    ];
    if (statistics) {
      const {
        nodes,
        bones,
        constraints,
        slots,
        vertices,
        weightedVertexTransforms,
        triangles,
        clippingVertices,
        maxInfluences,
        activeTracks,
      } = statistics.work;
      all.push(
        ...checkRuntimeBudget(
          {
            nodes,
            bones,
            constraints,
            slots,
            vertices,
            weightedVertexTransforms,
            triangles,
            clippingVertices,
            maxInfluences,
            activeTracks,
          },
          budget,
          artboardId,
          'frame',
        ),
      );
      all.push(
        ...checkRuntimeBudget(
          {
            updateP95Ms: statistics.profile.updateMs?.p95,
            renderSubmitP95Ms: statistics.profile.renderSubmitMs?.p95,
            drawCalls: statistics.profile.drawCalls?.p95 ?? null,
          },
          budget,
          artboardId,
          'profile',
        ),
      );
    }
    return [...new Map(all.map((entry) => [JSON.stringify(entry), entry])).values()];
  }, [report, publication, error, statistics, budget, artboardId, rigFindings]);
  const applyBudget = (candidate: RuntimeBudget) => {
    try {
      const valid = validateRuntimeBudget(candidate);
      setBudget(valid);
      try {
        saveShipBudget(localStorage, valid);
      } catch {
        setStatus('Budget is active; browser storage could not save it.');
      }
      return true;
    } catch (failure) {
      setStatus((failure as Error).message);
      return false;
    }
  };
  const publish = (
    bytes: ArrayBuffer,
    kind: Publication['kind'],
    compileDiagnostics: RuntimeDiagnostic[] = [],
  ) => {
    const program = loadRuntime(new Uint8Array(bytes)),
      asset = new NativeRuntimeAsset(program);
    setPublication({ asset, program, bytes, kind, compileDiagnostics });
    setFocusTargets([]);
    setArtboardId(program.defaultArtboardId);
    setInputOwner('');
    setPageIndex(0);
    setStatistics(null);
    setReady(false);
    setError(null);
    setFocusedTexture('');
  };
  const prepare = async () => {
    const ticket = ++epoch.current,
      controller = new AbortController();
    job.current?.abort();
    job.current = controller;
    setBusy(true);
    setError(null);
    setProgress({ fraction: 0, stage: 'snapshot' });
    try {
      const { project } = await captureProjectSnapshot(engine.project, textureRegistry.blobEntries(), {
        signal: controller.signal,
      });
      if (ticket !== epoch.current || controller.signal.aborted) return;
      const result = await compileNativeProject(project, {
        signal: controller.signal,
        defaultArtboardId: entryArtboardId,
        layout: { maxWidth: maxSize, maxHeight: maxSize, padding, allowRotation: rotation, powerOfTwo },
        raster: { scale, trim },
        svgFonts: (project.fonts ?? []).map(
          (font) => decodeFontBytes(font.base64, font.id).buffer as ArrayBuffer,
        ),
        progress: (fraction, stage) => {
          if (ticket === epoch.current) setProgress({ fraction, stage });
        },
      });
      if (ticket !== epoch.current) return;
      if (!result.runtime) throw new Error('Worker did not return a native asset.');
      publish(result.runtime.bytes, 'compiled', result.runtime.diagnostics);
      setStatus('Native asset prepared. Checking packaged playback resources.');
    } catch (failure) {
      if (ticket === epoch.current) {
        setError(finding(failure));
        setStatus((failure as Error).message);
      }
    } finally {
      if (ticket === epoch.current) {
        setBusy(false);
        job.current = null;
      }
    }
  };
  const cancel = () => {
    epoch.current++;
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setStatus('Native export cancelled.');
  };
  const invalidateAtlas = () => {
    epoch.current++;
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setStatus('Export settings changed. Prepare a new native snapshot.');
    setPublication(null);
    setFocusTargets([]);
    setStatistics(null);
    setReady(false);
    setError(null);
  };
  const control = (action: (native: NativePreviewHandle) => void) => {
    if (!handle.current) return;
    try {
      action(handle.current);
      handle.current.refresh();
    } catch (failure) {
      setStatus((failure as Error).message);
    }
  };
  const canDownload = ready && publication && !busy && !diagnostics.some((d) => d.severity === 'error');
  const filename = publication?.program.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'project';
  const page = publication?.program.atlasPages[pageIndex];
  const atlasObjects = useMemo(
    () =>
      new Set(
        publication
          ? [
              ...publication.program.atlasPages.map((page) => page.id),
              ...publication.program.textures
                .filter((texture) => texture.type === 'atlas')
                .map((texture) => texture.id),
              ...(publication.program.atlasPages.length ? [publication.program.id] : []),
            ]
          : [],
      ),
    [publication],
  );
  const focusSource = (target: ShipFocusTarget) => {
    engine.pause();
    engine.focusRig(target.artboardId, target.rigId);
    engine.mode = 'setup';
    const ui = useEditorStore.getState();
    ui.inspectSource(target);
    ui.setStatus(`Inspecting ${target.label}. Source content is unchanged.`);
  };
  const compatibility = useMemo(
    () => (publication ? inspectRuntimeCompatibility(publication.asset) : null),
    [publication],
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Ship workspace">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-700 p-2">
        <h1 className="mr-2 text-sm font-semibold">Ship</h1>
        <select
          className="rounded bg-neutral-800 text-xs"
          aria-label="Runtime entry artboard"
          value={entryArtboardId}
          onChange={(e) => {
            invalidateAtlas();
            setEntryArtboardId(e.target.value);
          }}
        >
          {engine.project.artboards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
        <button className={button} disabled={busy} onClick={() => void prepare()}>
          Prepare native export
        </button>
        {busy && (
          <>
            <button className={button} onClick={cancel}>
              Cancel native export
            </button>
            <progress
              aria-label="Native export progress"
              max={1}
              value={progress.fraction}
              className="w-28"
            />
            <span className="text-xs">
              {progress.stage} · {Math.round(progress.fraction * 100)}%
            </span>
          </>
        )}
        <button
          className={button}
          disabled={!canDownload}
          onClick={() =>
            publication && downloadProjectArtifact(new Blob([publication.bytes]), `${filename}.bbb`)
          }
        >
          Download .bbb
        </button>
        <button
          className={button}
          disabled={!canDownload}
          onClick={() =>
            publication &&
            downloadProjectArtifact(
              new Blob([serializeRuntime(publication.program)], { type: 'application/json' }),
              `${filename}.bbb.json`,
            )
          }
        >
          Download debug JSON
        </button>
        <button className={button} disabled={busy} onClick={() => chooser.current?.click()}>
          Open native .bbb
        </button>
        <input
          ref={chooser}
          hidden
          type="file"
          accept=".bbb,.bbb.json,application/json"
          aria-label="Open native asset"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const ticket = ++epoch.current;
            job.current?.abort();
            setBusy(true);
            try {
              if (file.size > RUNTIME_MAX_BYTES)
                throw new Error('Native asset exceeds the 128 MiB file limit.');
              const bytes = await file.arrayBuffer();
              if (ticket !== epoch.current) return;
              publish(bytes, 'loaded');
              setStatus(`Opened native ${file.name}. Source project retained.`);
            } catch (failure) {
              if (ticket === epoch.current) {
                setStatus(`Native open failed: ${(failure as Error).message}`);
                if (!publication) setError(finding(failure));
              }
            } finally {
              if (ticket === epoch.current) setBusy(false);
            }
          }}
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <aside
          className="w-64 shrink-0 overflow-auto border-r border-neutral-700 p-3"
          aria-label="Ship settings"
        >
          <label className="block text-xs">
            Platform warning policy
            <select
              className={field}
              aria-label="Ship platform"
              value={budget.preset}
              onChange={(e) => applyBudget(createRuntimeBudget(e.target.value as RuntimeBudgetPreset))}
            >
              <option value="mobile-low">Mobile Low</option>
              <option value="mobile-high">Mobile High</option>
              <option value="desktop">Desktop</option>
              <option value="web">Web</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <details className="mt-2 text-xs">
            <summary>Custom warning thresholds</summary>
            <label>
              Policy name
              <input
                className={field}
                aria-label="Ship policy name"
                key={budget.label}
                defaultValue={budget.label}
                onBlur={(e) => {
                  if (e.target.value === budget.label) return;
                  if (!applyBudget({ ...budget, preset: 'custom', label: e.target.value }))
                    e.target.value = budget.label;
                }}
              />
            </label>
            {RUNTIME_BUDGET_KEYS.map((key) => (
              <label key={key} className="mt-1 block">
                {key}
                <input
                  className={field}
                  aria-label={`Ship limit ${key}`}
                  key={budget.limits[key]}
                  type="number"
                  min={0}
                  step={key.endsWith('Ms') ? 'any' : 1}
                  defaultValue={budget.limits[key]}
                  onBlur={(e) => {
                    if (e.target.value.trim() && Number(e.target.value) === budget.limits[key]) return;
                    if (
                      !e.target.value.trim() ||
                      !applyBudget({
                        ...budget,
                        preset: 'custom',
                        limits: { ...budget.limits, [key]: Number(e.target.value) },
                      })
                    )
                      e.target.value = String(budget.limits[key]);
                  }}
                />
              </label>
            ))}
          </details>
          <p className="mt-2 text-xs text-neutral-400">
            Policies warn about cost. Confirm performance on your target device.
          </p>
          <label className="mt-3 block text-xs">
            Native viewport
            <select
              className={field}
              aria-label="Native viewport preset"
              value={viewportPreset}
              onChange={(e) => setViewportPreset(e.target.value)}
            >
              {Object.entries(PREVIEW_SIZES).map(([id, size]) => (
                <option key={id} value={id}>
                  {id} {size ? `· ${size.width}×${size.height}` : ''}
                </option>
              ))}
            </select>
          </label>
          <details className="mt-4 text-xs">
            <summary>Atlas settings</summary>
            <label className="mt-2 block">
              Maximum page size
              <select
                className={field}
                aria-label="Atlas maximum size"
                value={maxSize}
                onChange={(e) => {
                  invalidateAtlas();
                  setMaxSize(Number(e.target.value));
                }}
              >
                {[256, 512, 1024, 2048, 4096, 8192].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Padding
              <input
                className={field}
                aria-label="Atlas padding"
                type="number"
                min={0}
                max={64}
                value={padding}
                onChange={(e) => {
                  invalidateAtlas();
                  setPadding(Number(e.target.value));
                }}
              />
            </label>
            <label className="block">
              Export scale
              <input
                className={field}
                aria-label="Atlas scale"
                type="number"
                min={0.01}
                max={8}
                step="any"
                value={scale}
                onChange={(e) => {
                  invalidateAtlas();
                  setScale(Number(e.target.value));
                }}
              />
            </label>
            {(
              [
                ['Trim transparent borders', trim, setTrim],
                ['Rotate regions', rotation, setRotation],
                ['Power of two pages', powerOfTwo, setPowerOfTwo],
              ] as const
            ).map(([label, checked, change]) => (
              <label key={label} className="mt-1 block">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    invalidateAtlas();
                    change(e.target.checked);
                  }}
                />{' '}
                {label}
              </label>
            ))}
            <p className="mt-1 text-neutral-400">
              Straight alpha. Mesh and 9-slice regions preserve their full UV domain.
            </p>
          </details>
          {report && (
            <div className="mt-4 text-xs" aria-label="Shipping resource metrics">
              <h2 className="font-semibold">Packaged resources</h2>
              <p>
                {report.resources.logicalTextures} regions · {report.resources.physicalTextures} physical
                textures · {report.resources.atlasPages} atlas pages
              </p>
              <p>
                RGBA8 estimate:{' '}
                {report.resources.textureBytes === null
                  ? 'Unknown'
                  : `${(report.resources.textureBytes / 1048576).toFixed(2)} MiB`}
              </p>
              <p>
                Image bytes: {report.resources.encodedTextureBytes} · {report.resources.fonts} fonts (
                {report.resources.encodedFontBytes} bytes)
              </p>
              <details className="mt-2">
                <summary>All-variant rig inventory</summary>
                {report.artboards.map((board) => (
                  <div key={board.id}>
                    <strong>{board.name}</strong>
                    <pre className="overflow-auto text-[10px]">{JSON.stringify(board.metrics, null, 2)}</pre>
                  </div>
                ))}
              </details>
            </div>
          )}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {publication ? (
            <>
              <div className="flex flex-wrap gap-1 border-b border-neutral-700 p-2">
                <select
                  className="rounded bg-neutral-800 text-xs"
                  aria-label="Native artboard"
                  value={artboardId}
                  onChange={(e) => {
                    setArtboardId(e.target.value);
                    setInputOwner('');
                    setReady(false);
                    setStatistics(null);
                  }}
                >
                  {publication.program.artboards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
                <button
                  className={button}
                  disabled={!ready}
                  onClick={() =>
                    control(({ player }) => (statistics?.playing ? player.pause() : player.play()))
                  }
                >
                  {statistics?.playing ? 'Pause native' : 'Play native'}
                </button>
                <button
                  className={button}
                  disabled={!ready || Boolean(statistics?.playing)}
                  onClick={() =>
                    control(({ player }) => {
                      player.step();
                    })
                  }
                >
                  Step native
                </button>
                <button
                  className={button}
                  disabled={!ready}
                  onClick={() => control(({ player }) => player.stop())}
                >
                  Stop native
                </button>
                <button
                  className={button}
                  disabled={!ready}
                  onClick={() => control(({ player }) => player.reset())}
                >
                  Reset native
                </button>
                {ready && handle.current && (
                  <select
                    className="rounded bg-neutral-800 text-xs"
                    aria-label="Native scene clip"
                    value={
                      handle.current.player.scene.mode === 'animation'
                        ? (handle.current.player.scene.snapshot().clip ?? '')
                        : ''
                    }
                    key={artboardId}
                    onChange={(e) =>
                      control(({ player }) => {
                        if (e.target.value) player.play(e.target.value);
                        else if (
                          publication.program.artboards.find((board) => board.id === artboardId)?.logic
                        )
                          player.useLogic();
                        else player.scene.stop();
                      })
                    }
                  >
                    <option value="">Scene setup / Logic</option>
                    {handle.current.player.scene.getClips().map((clip) => (
                      <option key={clip.id} value={clip.id}>
                        {clip.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-xs">
                  {publication.kind === 'loaded' ? 'Loaded .bbb' : 'Compiled snapshot'} · native v
                  {publication.program.version}
                </span>
              </div>
              {ready && handle.current && (
                <div className="flex flex-wrap gap-2 px-2 py-1 text-xs">
                  {handle.current.player.getRigIds().map((id) => {
                    const rig = handle.current!.player.getRig(id);
                    const node = handle.current!.player.getView().nodes.find((n) => n.id === id);
                    return (
                      <label key={id}>
                        {node?.name}
                        <select
                          className="ml-1 rounded bg-neutral-800"
                          aria-label={`Native character clip ${id}`}
                          value={rig.mode === 'animation' ? (rig.snapshot().clip ?? '') : ''}
                          onChange={(e) =>
                            control(({ player }) => {
                              const child = player.getRig(id);
                              if (e.target.value) {
                                child.play(e.target.value);
                                player.play();
                              } else if (node?.type === 'rig' && node.logic) child.useLogic();
                              else child.stop();
                            })
                          }
                        >
                          <option value="">Setup / Logic</option>
                          {rig.getAnimations().map((clip) => (
                            <option key={clip.name}>{clip.name}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              )}
              <NativePreview
                asset={publication.asset}
                artboardId={artboardId}
                inputOwner={inputOwner}
                viewport={PREVIEW_SIZES[viewportPreset]}
                onInputError={setStatus}
                onReady={(native) => {
                  handle.current = native;
                  setReady(Boolean(native));
                }}
                onStatistics={setStatistics}
                onError={(message) => {
                  setError({
                    code: 'NATIVE_PREVIEW',
                    severity: 'error',
                    objectId: artboardId,
                    explanation: message,
                    remedy: 'Correct the native resource or preview configuration and prepare again.',
                  });
                  setStatus(message);
                }}
              />
              <details
                ref={atlasInspection}
                className="max-h-56 overflow-auto border-t border-neutral-700 p-2 text-xs"
                aria-label="Atlas inspection"
              >
                <summary>Atlas inspection ({publication.program.atlasPages.length} pages)</summary>
                {page ? (
                  <>
                    <select
                      aria-label="Atlas page"
                      className="mb-2 rounded bg-neutral-800"
                      value={pageIndex}
                      onChange={(e) => setPageIndex(Number(e.target.value))}
                    >
                      {publication.program.atlasPages.map((item, i) => (
                        <option key={item.id} value={i}>
                          Page {i + 1} · {item.width}×{item.height}
                        </option>
                      ))}
                    </select>
                    <div
                      className="relative max-w-lg"
                      style={{ aspectRatio: `${page.width}/${page.height}` }}
                    >
                      <img
                        className="w-full"
                        alt={`Atlas page ${pageIndex + 1}`}
                        src={`data:image/png;base64,${page.base64}`}
                      />
                      <svg
                        className="absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${page.width} ${page.height}`}
                        aria-label="Atlas regions"
                      >
                        {publication.program.textures.flatMap((texture) =>
                          texture.type === 'atlas' && texture.pageId === page.id
                            ? [
                                <rect
                                  key={texture.id}
                                  x={texture.frame.x}
                                  y={texture.frame.y}
                                  width={texture.frame.width}
                                  height={texture.frame.height}
                                  fill="transparent"
                                  stroke={focusedTexture === texture.id ? '#fbbf24' : '#38bdf8'}
                                  strokeWidth={Math.max(1, page.width / 500)}
                                  tabIndex={0}
                                  role="button"
                                  aria-label={`Atlas region ${texture.id}`}
                                  onClick={() => setFocusedTexture(texture.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setFocusedTexture(texture.id);
                                    }
                                  }}
                                >
                                  <title>
                                    {texture.id} · {texture.rotated ? 'rotated' : 'unrotated'} ·{' '}
                                    {texture.crop.width}×{texture.crop.height}
                                  </title>
                                </rect>,
                              ]
                            : [],
                        )}
                      </svg>
                    </div>
                    <p>{focusedTexture || 'Select a region to inspect its frame, crop and rotation.'}</p>
                    {focusedTexture && (
                      <pre>
                        {JSON.stringify(
                          publication.program.textures.find((t) => t.id === focusedTexture),
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </>
                ) : (
                  <p>This asset has no atlas pages.</p>
                )}
              </details>
            </>
          ) : (
            <p className="m-auto max-w-md p-6 text-sm text-neutral-400">
              Prepare a native export to check the packed images, fonts and playback. You can also open an
              existing .bbb while retaining the source project.
            </p>
          )}
        </div>
        <aside
          className="w-80 shrink-0 overflow-auto border-l border-neutral-700 p-3 text-xs"
          aria-label="Ship Doctor"
        >
          <h2 className="font-semibold">Ship Doctor</h2>
          {restoredBudget.warning && <p role="status">{restoredBudget.warning}</p>}
          <p className="mt-1">
            {diagnostics.filter((d) => d.severity === 'error').length} errors ·{' '}
            {diagnostics.filter((d) => d.severity === 'warning').length} warnings
          </p>
          <p className="mt-1 text-neutral-400">
            {ready
              ? 'Packaged resources decoded and native preview ready.'
              : publication
                ? 'Checking packaged preview…'
                : 'Prepare or open an asset to inspect it.'}
          </p>
          <ShipDoctorFindings
            diagnostics={diagnostics}
            compatibility={compatibility}
            atlasObjects={atlasObjects}
            onAtlas={(id) => {
              if (!publication) return;
              const texture = publication.program.textures.find(
                (texture) => texture.id === id && texture.type === 'atlas',
              );
              const pageId = texture?.type === 'atlas' ? texture.pageId : id;
              const index = publication.program.atlasPages.findIndex((page) => page.id === pageId);
              setPageIndex(Math.max(0, index));
              setFocusedTexture(texture?.id ?? '');
              if (atlasInspection.current) atlasInspection.current.open = true;
              setStatus('Inspecting the packaged atlas. Source content is unchanged.');
            }}
            canFocus={publication?.kind !== 'loaded'}
            onFocus={(entry) => {
              const targets = resolveShipFocus(engine.project, entry);
              if (targets.length === 1) focusSource(targets[0]!);
              else if (targets.length > 1) setFocusTargets(targets);
              else
                setStatus(
                  'This finding has no matching source object. Inspect the asset/settings or its remedy.',
                );
            }}
          />
          {focusTargets.length > 0 && (
            <div
              className="mt-2 rounded border border-neutral-600 p-2"
              role="group"
              aria-label="Matching source objects"
            >
              <p>Choose the source owner to inspect.</p>
              {focusTargets.map((target, index) => (
                <button key={index} className={button} onClick={() => focusSource(target)}>
                  {target.label}
                </button>
              ))}
              <button className={button} onClick={() => setFocusTargets([])}>
                Cancel source inspection
              </button>
            </div>
          )}
          {ready && handle.current && publication && (
            <details className="mt-4" open>
              <summary>Packaged Logic inputs</summary>
              <label className="block">
                Input owner
                <select
                  className={field}
                  aria-label="Native input owner"
                  value={inputOwner}
                  onChange={(e) => setInputOwner(e.target.value)}
                >
                  <option value="">Scene</option>
                  {handle.current.player.getRigIds().map((id) => (
                    <option key={id} value={id}>
                      {handle.current!.player.getView().nodes.find((n) => n.id === id)?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <NativeLogicControls
                key={`${artboardId}:${inputOwner}`}
                player={handle.current.player}
                owner={inputOwner}
                refresh={handle.current.refresh}
                onError={setStatus}
                graph={
                  inputOwner
                    ? (() => {
                        const node = handle.current!.player.getView().nodes.find((n) => n.id === inputOwner);
                        return node?.type === 'rig' ? node.logic : undefined;
                      })()
                    : publication.program.artboards.find((board) => board.id === artboardId)?.logic
                }
              />
            </details>
          )}
          {statistics && (
            <div className="mt-4" aria-label="Measured native profile">
              <h2 className="font-semibold">Current posed rig workload</h2>
              <p>
                {statistics.work.nodes} nodes · {statistics.work.bones} bones · {statistics.work.constraints}{' '}
                constraints · {statistics.work.slots} slots
              </p>
              <p>
                {statistics.work.vertices} vertices · {statistics.work.triangles} content triangles ·{' '}
                {statistics.work.clippingVertices} clip vertices
              </p>
              <p>
                {statistics.work.weightedVertexTransforms} weighted transforms per posed update ·{' '}
                {statistics.work.activeTracks} selected timelines
              </p>
              <h3 className="mt-2 font-semibold">
                Measured CPU window ({statistics.profile.samples} frames)
              </h3>
              <p>Update + sync p95: {readable(statistics.profile.updateMs?.p95)} ms</p>
              <p>Render submission p95: {readable(statistics.profile.renderSubmitMs?.p95)} ms</p>
              <p>
                Core WebGL2 draws p95: {readable(statistics.profile.drawCalls?.p95)} (
                {statistics.profile.drawCallSamples} measured frames)
              </p>
              <p className="text-neutral-400">
                CPU timings are not GPU timing or device FPS certification. Posed counts include hidden rig
                workload; UI/mask GPU geometry is separate.
              </p>
              <details className="mt-2">
                <summary>Recent native events ({statistics.events.length})</summary>
                <pre className="overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(statistics.events.slice(-6), null, 2)}
                </pre>
              </details>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
