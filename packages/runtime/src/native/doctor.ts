import { AtlasError, readRasterSize } from '@limber/atlas';
import { expandUIComponents, meshGeometryOwner, type AttachmentData } from '@limber/core';
import { NativeRuntimeAsset, nativeAssetState } from './NativeRuntimeAsset';
import { RuntimeFormatError, runtimeFail, type RuntimeDiagnostic } from './model';
import { diagnoseNativeFonts } from './fonts';
import type { NativeArtboardPlayer } from './NativeArtboardPlayer';

export const RUNTIME_BUDGET_KEYS = [
  'nodes',
  'bones',
  'constraints',
  'slots',
  'vertices',
  'weightedVertexTransforms',
  'triangles',
  'clippingVertices',
  'maxInfluences',
  'atlasPages',
  'textureDimension',
  'textureBytes',
  'activeTracks',
  'drawCalls',
  'updateP95Ms',
  'renderSubmitP95Ms',
] as const;
export type RuntimeBudgetKey = (typeof RUNTIME_BUDGET_KEYS)[number];
export type RuntimeBudgetPreset = 'mobile-low' | 'mobile-high' | 'desktop' | 'web' | 'custom';
export interface RuntimeBudget {
  preset: RuntimeBudgetPreset;
  label: string;
  limits: Record<RuntimeBudgetKey, number>;
}
export type RuntimeBudgetValues = Partial<Record<RuntimeBudgetKey, number | null>>;
export interface RuntimeBudgetDiagnostic extends RuntimeDiagnostic {
  scope: 'inventory' | 'frame' | 'resources' | 'profile';
  metric: RuntimeBudgetKey;
  actual: number;
  limit: number;
}
const mib = 1024 * 1024;
const presets = {
  'mobile-low': [1024, 128, 32, 128, 20000, 60000, 12000, 64, 4, 2, 2048, 32 * mib, 16, 32, 4, 4],
  'mobile-high': [4096, 512, 128, 512, 80000, 320000, 50000, 256, 4, 4, 4096, 128 * mib, 64, 64, 4, 4],
  desktop: [10000, 2048, 512, 2048, 250000, 2000000, 150000, 1024, 8, 16, 8192, 512 * mib, 256, 256, 8, 8],
  web: [2048, 256, 64, 256, 40000, 160000, 24000, 128, 4, 4, 4096, 64 * mib, 32, 64, 4, 4],
} as const;
/** Starting warning policies, not verified device capabilities or hard ingestion limits. */
export function createRuntimeBudget(
  preset: RuntimeBudgetPreset = 'web',
  overrides: Partial<Record<RuntimeBudgetKey, number>> = {},
): RuntimeBudget {
  if (preset !== 'custom' && !Object.hasOwn(presets, preset))
    runtimeFail(
      'INVALID_BUDGET',
      'Unknown platform budget preset.',
      null,
      'Choose a supported platform preset.',
    );
  const values = presets[preset === 'custom' ? 'web' : preset];
  return validateRuntimeBudget({
    preset,
    label: preset,
    limits: { ...Object.fromEntries(RUNTIME_BUDGET_KEYS.map((key, i) => [key, values[i]])), ...overrides },
  });
}
export function validateRuntimeBudget(input: unknown): RuntimeBudget {
  const invalid = (): never =>
    runtimeFail(
      'INVALID_BUDGET',
      'Platform budget requires every known finite nonnegative threshold.',
      null,
      'Restore a preset or enter valid custom thresholds.',
    );
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    Object.keys(value).some((key) => !['preset', 'label', 'limits'].includes(key)) ||
    typeof value.preset !== 'string' ||
    (!Object.hasOwn(presets, value.preset) && value.preset !== 'custom') ||
    typeof value.label !== 'string' ||
    !value.label.trim() ||
    value.label.length > 80 ||
    !value.limits ||
    typeof value.limits !== 'object' ||
    Array.isArray(value.limits)
  )
    return invalid();
  const limits = value.limits as Record<string, unknown>;
  if (
    Object.keys(limits).length !== RUNTIME_BUDGET_KEYS.length ||
    Object.keys(limits).some((key) => !(RUNTIME_BUDGET_KEYS as readonly string[]).includes(key))
  )
    return invalid();
  for (const key of RUNTIME_BUDGET_KEYS) {
    const n = limits[key];
    if (
      !Object.hasOwn(limits, key) ||
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < 0 ||
      n > Number.MAX_SAFE_INTEGER ||
      (!key.endsWith('Ms') && !Number.isSafeInteger(n))
    )
      return invalid();
  }
  return {
    preset: value.preset as RuntimeBudgetPreset,
    label: value.label,
    limits: { ...limits } as RuntimeBudget['limits'],
  };
}
const remedies: Record<RuntimeBudgetKey, string> = {
  nodes: 'Reduce expanded scene nodes or split the artboard.',
  bones: 'Remove unused bones or split the character workload.',
  constraints: 'Reduce solver constraints and preview the result.',
  slots: 'Merge or remove unused character slots.',
  vertices: 'Simplify mesh topology or reduce attachment variants.',
  weightedVertexTransforms: 'Prune influences or simplify weighted meshes.',
  triangles: 'Simplify mesh topology.',
  clippingVertices: 'Simplify clipping polygons or replace unnecessary masks.',
  maxInfluences: 'Prune vertex influences and preview deformation.',
  atlasPages: 'Repack or split the asset texture workload.',
  textureDimension: 'Reduce texture dimensions or the atlas page size.',
  textureBytes: 'Reduce texture size/export scale or split the asset.',
  activeTracks: 'Reduce simultaneously selected animation tracks.',
  drawCalls: 'Repack textures, group compatible draws or simplify clipping.',
  updateP95Ms: 'Profile skinning, constraints and active animation work on the target.',
  renderSubmitP95Ms: 'Profile draw submission, masks and texture switches on the target.',
};
/** Missing/unmeasured values remain unknown; zero is an actual measurement/count. */
export function checkRuntimeBudget(
  values: RuntimeBudgetValues,
  input: RuntimeBudget,
  objectId: string | null,
  scope: RuntimeBudgetDiagnostic['scope'],
): RuntimeBudgetDiagnostic[] {
  const budget = validateRuntimeBudget(input),
    findings: RuntimeBudgetDiagnostic[] = [];
  if (!values || typeof values !== 'object' || Array.isArray(values))
    runtimeFail(
      'INVALID_METRIC',
      'Expected a runtime metric record.',
      objectId,
      'Supply measured work fields.',
    );
  for (const key of Object.keys(values))
    if (!(RUNTIME_BUDGET_KEYS as readonly string[]).includes(key))
      runtimeFail(
        'INVALID_METRIC',
        'Unknown runtime work metric.',
        objectId,
        'Supply known measured work fields.',
      );
  for (const metric of RUNTIME_BUDGET_KEYS) {
    const actual = values[metric];
    if (actual === undefined || actual === null) continue;
    if (
      typeof actual !== 'number' ||
      !Number.isFinite(actual) ||
      actual < 0 ||
      actual > Number.MAX_SAFE_INTEGER ||
      (!metric.endsWith('Ms') && !Number.isSafeInteger(actual))
    )
      runtimeFail(
        'INVALID_METRIC',
        'Runtime work metrics must be finite nonnegative counts/timings.',
        objectId,
        'Supply actual work counts or leave unavailable fields unknown.',
      );
    const limit = budget.limits[metric];
    if (actual > limit)
      findings.push({
        code: `BUDGET_${metric.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`,
        severity: 'warning',
        objectId,
        scope,
        metric,
        actual,
        limit,
        explanation: `${scope} ${metric}: ${actual} exceeds ${budget.label} warning threshold ${limit}.`,
        remedy: remedies[metric],
      });
  }
  return findings;
}
export interface RuntimeInventoryMetrics {
  nodes: number;
  rigs: number;
  bones: number;
  constraints: number;
  slots: number;
  vertices: number;
  weightedVertexTransforms: number;
  triangles: number;
  clippingVertices: number;
  maxInfluences: number;
  animationTimelines: number;
}
export interface RuntimeResourceMetrics {
  logicalTextures: number;
  physicalTextures: number;
  atlasPages: number;
  textureDimension: number | null;
  textureBytes: number | null;
  encodedTextureBytes: number;
  fonts: number;
  encodedFontBytes: number;
}
export interface RuntimeInventoryReport {
  resources: RuntimeResourceMetrics;
  artboards: { id: string; name: string; metrics: RuntimeInventoryMetrics }[];
  diagnostics: RuntimeDiagnostic[];
  budget: RuntimeBudget;
}
function attachmentWork(attachment: AttachmentData, vertices: number) {
  let transforms = 0,
    maxInfluences = 0,
    weightedVertices = 0,
    weightedTransforms = 0,
    offset = 0;
  for (let i = 0; i < vertices; i++) {
    const count = attachment.weights?.[offset] ?? 0;
    transforms += Math.max(1, count);
    maxInfluences = Math.max(maxInfluences, count);
    if (count > 0) {
      weightedVertices++;
      weightedTransforms += count;
    }
    offset += 1 + count * 2;
  }
  return { transforms, maxInfluences, weightedVertices, weightedTransforms };
}
const decodedLength = (base64: string) =>
  (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
/** On-demand immutable inventory, all skins/attachments. It never advances a player. */
export function inspectRuntimeInventory(
  asset: NativeRuntimeAsset,
  input: RuntimeBudget = createRuntimeBudget(),
): RuntimeInventoryReport {
  const budget = validateRuntimeBudget(input),
    state = nativeAssetState(asset),
    { program, project } = state,
    diagnostics: RuntimeDiagnostic[] = diagnoseNativeFonts(program);
  let textureDimension: number | null = 0,
    textureBytes: number | null = 0,
    encodedTextureBytes = 0;
  const physical = [
    ...program.atlasPages.map((p) => ({ ...p, type: 'page' as const })),
    ...program.textures.filter((t) => t.type === 'image'),
  ];
  for (const texture of physical) {
    encodedTextureBytes += decodedLength(texture.base64);
    try {
      const dimensions =
        texture.type === 'page'
          ? texture
          : readRasterSize(
              Uint8Array.from(atob(texture.base64), (c) => c.charCodeAt(0)),
              texture.mime,
              texture.id,
            );
      if (
        !Number.isSafeInteger(dimensions.width) ||
        !Number.isSafeInteger(dimensions.height) ||
        dimensions.width < 1 ||
        dimensions.height < 1 ||
        dimensions.width > 16384 ||
        dimensions.height > 16384
      )
        runtimeFail(
          'IMAGE_DIMENSIONS',
          'Texture dimensions are outside native decode bounds.',
          texture.id,
          'Reimport or downscale the texture.',
        );
      if (textureDimension !== null)
        textureDimension = Math.max(textureDimension, dimensions.width, dimensions.height);
      if (textureBytes !== null) textureBytes += dimensions.width * dimensions.height * 4;
      diagnostics.push(
        ...checkRuntimeBudget(
          { textureDimension: Math.max(dimensions.width, dimensions.height) },
          budget,
          texture.id,
          'resources',
        ),
      );
    } catch (error) {
      textureDimension = textureBytes = null;
      if (error instanceof RuntimeFormatError) diagnostics.push({ ...error.diagnostic });
      else if (error instanceof AtlasError)
        diagnostics.push({
          code: error.code,
          severity: 'error',
          objectId: texture.id,
          explanation: error.message,
          remedy: error.remedy,
        });
      else throw error;
    }
  }
  const resources: RuntimeResourceMetrics = {
    logicalTextures: program.textures.length,
    physicalTextures: physical.length,
    atlasPages: program.atlasPages.length,
    textureDimension,
    textureBytes,
    encodedTextureBytes,
    fonts: program.fonts.length,
    encodedFontBytes: program.fonts.reduce((sum, font) => sum + decodedLength(font.base64), 0),
  };
  diagnostics.push(
    ...checkRuntimeBudget(
      { atlasPages: resources.atlasPages, textureBytes },
      budget,
      program.id,
      'resources',
    ),
  );
  const artboards = project.artboards.map((board) => {
    const expanded = expandUIComponents(project, board).artboard;
    const metrics: RuntimeInventoryMetrics = {
      nodes: expanded.nodes.length,
      rigs: 0,
      bones: 0,
      constraints: 0,
      slots: 0,
      vertices: 0,
      weightedVertexTransforms: 0,
      triangles: 0,
      clippingVertices: 0,
      maxInfluences: 0,
      animationTimelines: board.clips?.reduce((sum, clip) => sum + clip.tracks.length, 0) ?? 0,
    };
    for (const node of expanded.nodes) {
      if (node.type !== 'rig') continue;
      const s = node.skeleton,
        owners = new Map(s.attachments.map((a) => [a.id, a]));
      metrics.rigs++;
      metrics.bones += s.bones.length;
      metrics.slots += s.slots.length;
      metrics.constraints +=
        s.ikConstraints.length +
        (s.transformConstraints?.length ?? 0) +
        (s.pathConstraints?.length ?? 0) +
        (s.secondaryConstraints?.length ?? 0);
      metrics.animationTimelines += node.animations.reduce((sum, clip) => sum + clip.timelines.length, 0);
      for (const attachment of s.attachments) {
        const geometry = meshGeometryOwner(attachment, owners),
          vertices =
            (attachment.type === 'region' ? geometry.vertices?.length : geometry.meshVertices?.length) ?? 0,
          work = attachmentWork(attachment, vertices / 2);
        // Count shared geometry once, while each variant retains its independent weights.
        if (geometry === attachment) {
          metrics.vertices += vertices / 2;
          metrics.triangles +=
            attachment.type === 'region'
              ? 2
              : attachment.type === 'mesh'
                ? (geometry.meshTriangles?.length ?? 0) / 3
                : 0;
        }
        if (attachment.type === 'clipping') metrics.clippingVertices += vertices / 2;
        metrics.weightedVertexTransforms += work.weightedTransforms;
        metrics.maxInfluences = Math.max(metrics.maxInfluences, work.maxInfluences);
        diagnostics.push(
          ...checkRuntimeBudget({ maxInfluences: work.maxInfluences }, budget, attachment.id, 'inventory'),
        );
      }
    }
    const { rigs: _rigs, animationTimelines: _timelines, maxInfluences: _max, ...counts } = metrics;
    diagnostics.push(...checkRuntimeBudget(counts, budget, board.id, 'inventory'));
    return { id: board.id, name: board.name, metrics };
  });
  return { resources, artboards, diagnostics, budget };
}

export interface RuntimeFrameWork {
  nodes: number;
  visibleNodes: number;
  rigs: number;
  bones: number;
  constraints: number;
  slots: number;
  attachments: number;
  vertices: number;
  rigidVertices: number;
  weightedVertices: number;
  vertexTransforms: number;
  weightedVertexTransforms: number;
  bindMatrixProducts: number;
  triangles: number;
  clippingVertices: number;
  maxInfluences: number;
  activeTracks: number;
}
/** Current pose skinning workload, including hidden rigs. No solver/skinning call or mutation. */
export function inspectRuntimeFrame(player: NativeArtboardPlayer): RuntimeFrameWork {
  const entries = player.evaluate();
  const work: RuntimeFrameWork = {
    nodes: entries.length,
    visibleNodes: entries.filter((entry) => entry.visible && entry.opacity > 0).length,
    rigs: 0,
    bones: 0,
    constraints: 0,
    slots: 0,
    attachments: 0,
    vertices: 0,
    rigidVertices: 0,
    weightedVertices: 0,
    vertexTransforms: 0,
    weightedVertexTransforms: 0,
    bindMatrixProducts: 0,
    triangles: 0,
    clippingVertices: 0,
    maxInfluences: 0,
    activeTracks: player.scene.activeTrackCount,
  };
  for (const id of player.getRigIds()) {
    const rig = player.getRig(id),
      skeleton = rig.skeleton,
      { data, pose } = skeleton;
    work.rigs++;
    work.bones += data.bones.length;
    work.slots += data.slots.length;
    work.constraints += skeleton.constraintOrder.length;
    work.activeTracks += rig.activeTrackCount;
    for (const slot of pose.slots) {
      if (!slot.attachmentId) continue;
      const attachment = skeleton.attachmentById.get(slot.attachmentId),
        state = pose.attachments.get(slot.attachmentId);
      if (!attachment || !state) continue;
      const vertices = state.verts.length / 2,
        weighted = attachmentWork(attachment, vertices);
      work.attachments++;
      work.vertices += vertices;
      work.rigidVertices += vertices - weighted.weightedVertices;
      work.weightedVertices += weighted.weightedVertices;
      work.vertexTransforms += weighted.transforms;
      work.weightedVertexTransforms += weighted.weightedTransforms;
      work.maxInfluences = Math.max(work.maxInfluences, weighted.maxInfluences);
      if (state.bindMatrices) work.bindMatrixProducts += data.bones.length;
      if (attachment.type === 'region') work.triangles += 2;
      if (attachment.type === 'mesh') work.triangles += (attachment.meshTriangles?.length ?? 0) / 3;
      if (attachment.type === 'clipping') work.clippingVertices += vertices;
    }
  }
  return work;
}
