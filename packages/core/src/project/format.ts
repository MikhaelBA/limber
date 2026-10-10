import { SCENE_PROPERTIES } from './motion';
import { validateUIInsets, validateUINode, validateUIProject } from './uiValidation';
import { deserializeDocument } from '../serialization/serialize';
import { Skeleton } from '../skeleton/Skeleton';
import { meshJSONReplacer } from '../skeleton/meshLinks';
import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, projectFromLegacy, type BoneByBoneProject } from './model';
import { validateLogicGraph } from '../logic/validate';
import type { Animation } from '../types/animation';
import type { SceneClip } from './motion';
import { validateEventPayload, validateEventName } from '../animation/eventPayload';
import { LogicEventSampler } from '../logic/eventSampling';
import type { LogicGraph } from '../logic/model';
import { LogicSceneBindings } from '../logic/LogicSceneBindings';

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

function validateClips(value: unknown, nodeIds: Set<string>, ids: Set<string>): void {
  if (value === undefined) return;
  const takeId = (value: unknown, label: string) => {
    text(value, label);
    if (ids.has(value)) fail('DUPLICATE_ID', `Duplicate ID ${value}.`, value);
    ids.add(value);
    return value;
  };
  for (const item of array(value, 'Scene clips')) {
    const clip = record(item, 'Scene clip');
    const id = takeId(clip.id, 'Clip ID');
    text(clip.name, 'Clip name');
    finite(clip.duration, 'Clip duration', Number.EPSILON);
    if (typeof clip.loop !== 'boolean') fail('INVALID_CLIP', 'Clip loop must be boolean.', id);
    finite(clip.fps, 'Clip FPS', 1);
    if (!Number.isInteger(clip.fps) || Number(clip.fps) > 240)
      fail('INVALID_CLIP', 'Clip FPS must be an integer from 1 to 240.', id);
    const targets = new Set<string>();
    for (const item of array(clip.tracks, 'Scene tracks')) {
      const track = record(item, 'Scene track');
      const trackId = takeId(track.id, 'Track ID');
      text(track.nodeId, 'Track node ID');
      if (!nodeIds.has(track.nodeId))
        fail('BROKEN_REFERENCE', `Track ${trackId} references a missing scene node.`, trackId);
      if (!SCENE_PROPERTIES.includes(track.property as (typeof SCENE_PROPERTIES)[number]))
        fail('INVALID_TRACK', `Unsupported scene property ${String(track.property)}.`, trackId);
      const target = JSON.stringify([track.nodeId, track.property]);
      if (targets.has(target))
        fail('DUPLICATE_TRACK', 'Only one track per node/property is allowed.', trackId);
      targets.add(target);
      let previous = -1;
      for (const item of array(track.keys, 'Scene keys')) {
        const key = record(item, 'Scene key');
        const keyId = takeId(key.id, 'Key ID');
        finite(key.time, 'Key time', 0);
        finite(key.value, 'Key value');
        if (Number(key.time) <= previous || Number(key.time) > Number(clip.duration))
          fail('INVALID_KEY_TIME', 'Keys must increase strictly and stay within clip duration.', keyId);
        previous = Number(key.time);
        const curve = record(key.curve, 'Key curve');
        if (!['linear', 'stepped', 'bezier'].includes(String(curve.type)))
          fail('INVALID_CURVE', 'Unknown scene key curve.', keyId);
        if (curve.type === 'bezier') {
          for (const name of ['c1', 'c2', 'c3', 'c4']) finite(curve[name], `Curve ${name}`);
          if (Number(curve.c1) < 0 || Number(curve.c1) > 1 || Number(curve.c3) < 0 || Number(curve.c3) > 1)
            fail('INVALID_CURVE', 'Bezier time handles must be within [0,1].', keyId);
        }
      }
    }
    let previous = -1;
    if (array(clip.events, 'Scene events').length > 512)
      fail('EVENT_LIMIT', 'A clip supports at most 512 event keys.', id);
    for (const item of array(clip.events, 'Scene events')) {
      const event = record(item, 'Scene event');
      const eventId = takeId(event.id, 'Event ID');
      validateEventName(event.name);
      finite(event.time, 'Event time', 0);
      if (Number(event.time) < previous || Number(event.time) > Number(clip.duration))
        fail('INVALID_EVENT_TIME', 'Events must be ordered within clip duration.', eventId);
      previous = Number(event.time);
      validateEventPayload(event.payload);
    }
  }
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
  const components = project.components === undefined ? [] : array(project.components, 'Components');
  for (const item of [...artboards, ...components]) {
    const artboard = record(item, 'Artboard');
    text(artboard.id, 'Artboard ID');
    text(artboard.name, 'Artboard name');
    if (ids.has(artboard.id)) fail('DUPLICATE_ID', `Duplicate ID ${artboard.id}.`, artboard.id);
    ids.add(artboard.id);
    finite(artboard.width, 'Artboard width', 1);
    finite(artboard.height, 'Artboard height', 1);
    if (artboard.safeArea !== undefined) validateUIInsets(artboard.safeArea, artboard.width, artboard.height);
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
      if (
        node.tint !== undefined &&
        (!Number.isInteger(node.tint) ||
          typeof node.tint !== 'number' ||
          node.tint < 0 ||
          node.tint > 0xffffff)
      )
        fail('INVALID_VISUAL', `Invalid tint for ${node.id}.`, node.id);
      validateUINode(node);
      if (node.logic !== undefined && node.type !== 'rig')
        fail('GRAPH_OWNER', 'Only artboards and rig nodes may own Logic graphs.', node.id);
      if (node.type === 'image' || node.type === 'nineSlice') {
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
        if (node.logic !== undefined) {
          if (!artboards.includes(artboard))
            fail('COMPONENT_LOGIC', 'Component-local graphs are not supported yet.', node.id);
          const animations = node.animations as Animation[];
          const names = new Set(animations.map((a) => a.name));
          if (names.size !== animations.length)
            fail('DUPLICATE_CLIP_NAME', 'Logic rigs require unique animation names.', node.id);
          validateLogicGraph(node.logic, new Map(animations.map((a) => [a.name, { duration: a.duration }])));
          if ((node.logic as LogicGraph).bindings?.length)
            fail('RIG_SCENE_BINDING', 'Scene exposure bindings belong to the artboard Logic graph.', node.id);
          for (const state of (node.logic as LogicGraph).states)
            if (state.clip !== null) {
              const clip = animations.find((a) => a.name === state.clip)!;
              new LogicEventSampler(
                clip.duration,
                clip.timelines.flatMap((t) => (t.kind === 'event' ? t.keyframes : [])),
              ).validateLoop(state.loop);
            }
        }
      } else if (!['group', 'text', 'shape', 'mask', 'instance'].includes(String(node.type)))
        fail('UNKNOWN_NODE', `Unsupported scene node type ${String(node.type)}.`, node.id);
    }
    validateClips(artboard.clips, new Set(byId.keys()), ids);
    if (artboard.logic !== undefined) {
      if (!artboards.includes(item))
        fail('COMPONENT_LOGIC', 'Component-local graphs are not supported yet.', artboard.id);
      validateLogicGraph(
        artboard.logic,
        new Map(((artboard.clips ?? []) as SceneClip[]).map((c) => [c.id, { duration: c.duration }])),
      );
      for (const state of (artboard.logic as LogicGraph).states)
        if (state.clip !== null) {
          const clip = (artboard.clips as SceneClip[]).find((c) => c.id === state.clip)!;
          new LogicEventSampler(
            clip.duration,
            clip.events.map((e) => ({ time: e.time, eventName: e.name, payload: e.payload })),
          ).validateLoop(state.loop);
        }
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
        if (parent !== null && !['group', 'mask'].includes(String(byId.get(parent)?.type)))
          fail(
            'INVALID_PARENT',
            `Node ${current} must have a group or mask parent in the same artboard.`,
            current,
          );
        current = parent;
      }
      for (const visited of path) done.add(visited);
    }
    if (artboards.includes(item) && artboard.id === editor.activeArtboardId) {
      activeFound = true;
      if (editor.activeRigId !== null && byId.get(editor.activeRigId as string)?.type !== 'rig')
        fail('BROKEN_REFERENCE', 'Active rig is missing from the active artboard.');
    }
  }
  if (!activeFound) fail('BROKEN_REFERENCE', 'Active artboard does not exist.');
  validateUIProject(project as unknown as BoneByBoneProject);
  const typed = project as unknown as BoneByBoneProject;
  for (const board of typed.artboards)
    if (board.logic) new LogicSceneBindings(board.logic, board, typed.components);
}

export function serializeProject(project: BoneByBoneProject): string {
  validateProject(project);
  return JSON.stringify(project, meshJSONReplacer, 2);
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
  // Missing clips/layout/components preserve their historical empty/absolute defaults.
  if (
    project.schemaVersion === 1 ||
    project.schemaVersion === 2 ||
    project.schemaVersion === 3 ||
    project.schemaVersion === 4 ||
    project.schemaVersion === 5 ||
    project.schemaVersion === 6 ||
    project.schemaVersion === 7 ||
    project.schemaVersion === 8 ||
    project.schemaVersion === 9 ||
    project.schemaVersion === 10 ||
    project.schemaVersion === 11
  )
    project.schemaVersion = PROJECT_SCHEMA_VERSION;
  validateProject(project);
  return project;
}
