import { deserializeDocument } from '../serialization/serialize';
import { Skeleton } from '../skeleton/Skeleton';
import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, projectFromLegacy, type BoneByBoneProject } from './model';

export class ProjectFormatError extends Error {
  constructor(
    readonly code: string,
    readonly objectId: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

function fail(code: string, message: string, id: string | null = null): never {
  throw new ProjectFormatError(code, id, message);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('INVALID_OBJECT', `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    fail('INVALID_TEXT', `${label} must be a non-empty string.`);
}
function finite(value: unknown, label: string, min = -Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min)
    fail('INVALID_NUMBER', `${label} must be finite and >= ${min}.`);
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail('INVALID_ARRAY', `${label} must be an array.`);
  return value;
}

/** Validate before changing the active editor. O(nodes + parent links), without recursion. */
export function validateProject(value: unknown): asserts value is BoneByBoneProject {
  const project = record(value, 'Project');
  if (project.format !== PROJECT_FORMAT) fail('WRONG_FORMAT', 'Expected a BoneByBone authoring project.');
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    fail(
      'UNSUPPORTED_SCHEMA',
      `Project schema ${String(project.schemaVersion)} is unsupported; expected ${PROJECT_SCHEMA_VERSION}. Keep the original file and use a compatible editor.`,
    );
  }
  text(project.projectId, 'Project ID');
  text(project.name, 'Project name');
  const manifest = record(project.assetManifest, 'Asset manifest');
  for (const [id, value] of Object.entries(manifest)) {
    text(id, 'Asset ID');
    const meta = record(value, `Asset ${id}`);
    text(meta.name, 'Asset name');
    if (meta.source !== 'embedded' && meta.source !== 'atlas')
      fail('INVALID_ASSET', `Unsupported asset source for ${id}.`, id);
    if (
      meta.dataUrl !== undefined &&
      (typeof meta.dataUrl !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(meta.dataUrl))
    ) {
      fail('INVALID_ASSET', `Embedded asset ${id} must be an image data URL.`, id);
    }
  }
  const artboards = array(project.artboards, 'Artboards');
  if (!artboards.length) fail('EMPTY_PROJECT', 'A project must contain at least one artboard.');
  const editor = record(project.editor, 'Editor state');
  text(editor.activeArtboardId, 'Active artboard ID');
  if (editor.activeRigId !== null) text(editor.activeRigId, 'Active rig ID');
  const ids = new Set<string>([project.projectId]);
  let activeFound = false;
  for (const item of artboards) {
    const artboard = record(item, 'Artboard');
    text(artboard.id, 'Artboard ID');
    text(artboard.name, 'Artboard name');
    if (ids.has(artboard.id)) fail('DUPLICATE_ID', `Duplicate ID ${artboard.id}.`, artboard.id);
    ids.add(artboard.id);
    finite(artboard.width, 'Artboard width', 1);
    finite(artboard.height, 'Artboard height', 1);
    const nodes = array(artboard.nodes, 'Scene nodes');
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of nodes) {
      const node = record(item, 'Scene node');
      text(node.id, 'Node ID');
      text(node.name, 'Node name');
      if (ids.has(node.id)) fail('DUPLICATE_ID', `Duplicate ID ${node.id}.`, node.id);
      ids.add(node.id);
      byId.set(node.id, node);
      if (node.parentId !== null) text(node.parentId, 'Parent ID');
      const transform = record(node.transform, 'Node transform');
      for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY', 'pivotX', 'pivotY'])
        finite(transform[key], `Transform ${key}`);
      finite(node.opacity, 'Opacity', 0);
      if (node.opacity > 1 || typeof node.visible !== 'boolean')
        fail('INVALID_VISUAL', `Invalid opacity/visibility for ${node.id}.`, node.id);
      if (node.type === 'image') {
        text(node.textureId, 'Image texture ID');
        if (!Object.hasOwn(manifest, node.textureId))
          fail('BROKEN_REFERENCE', `Image ${node.id} references a missing asset.`, node.id);
        finite(node.width, 'Image width', 0);
        finite(node.height, 'Image height', 0);
      } else if (node.type === 'rig') {
        // Reuse legacy structural checks; validation must not sort/mutate source data.
        const doc = deserializeDocument(
          JSON.stringify({
            version: 2,
            skeleton: node.skeleton,
            animations: node.animations,
            assetManifest: manifest,
          }),
        );
        new Skeleton(doc.skeleton);
      } else if (node.type !== 'group')
        fail('UNKNOWN_NODE', `Unsupported scene node type ${String(node.type)}.`, node.id);
    }
    // Each ancestor path is visited once, including already-completed paths.
    const done = new Set<string>();
    for (const id of byId.keys()) {
      const path = new Set<string>();
      let current: string | null = id;
      while (current !== null && !done.has(current)) {
        if (path.has(current)) fail('PARENT_CYCLE', `Scene hierarchy has a cycle at ${current}.`, current);
        const node = byId.get(current);
        if (!node) fail('BROKEN_REFERENCE', `Scene parent ${current} is missing from its artboard.`, id);
        path.add(current);
        const parent = node.parentId as string | null;
        if (parent !== null && byId.get(parent)?.type !== 'group')
          fail('INVALID_PARENT', `Node ${current} must have a group parent in the same artboard.`, current);
        current = parent;
      }
      for (const visited of path) done.add(visited);
    }
    if (artboard.id === editor.activeArtboardId) {
      activeFound = true;
      if (editor.activeRigId !== null && byId.get(editor.activeRigId as string)?.type !== 'rig')
        fail('BROKEN_REFERENCE', 'Active rig is missing from the active artboard.');
    }
  }
  if (!activeFound) fail('BROKEN_REFERENCE', 'Active artboard does not exist.');
}

export function serializeProject(project: BoneByBoneProject): string {
  validateProject(project);
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string, legacyName = 'Imported project'): BoneByBoneProject {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail('INVALID_JSON', 'This file is not valid JSON.');
  }
  const candidate = record(raw, 'Project');
  const project =
    candidate.format === undefined ? projectFromLegacy(deserializeDocument(json), legacyName) : candidate;
  validateProject(project);
  return project;
}
