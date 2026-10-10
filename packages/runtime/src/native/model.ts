import type {
  Artboard,
  Curve,
  EventPayload,
  LogicGraph,
  SceneNode,
  SceneProperty,
  UIComponent,
  EmbeddedFont,
} from '@limber/core';

export const RUNTIME_FORMAT = 'bonebybone-runtime' as const;
export const RUNTIME_VERSION = 1 as const;
/** Resource bounds apply before constructing a player or decoding image pixels. */
export const RUNTIME_MAX_BYTES = 128 * 1024 * 1024;
export const RUNTIME_FEATURES = [
  'atlas',
  'fonts',
  'logic',
  'logic-bindings',
  'logic-routes',
  'rig',
  'rig-clipping',
  'rig-deform',
  'rig-ik',
  'rig-markers',
  'rig-mesh',
  'rig-path',
  'rig-secondary',
  'rig-shared-mesh',
  'rig-skins',
  'rig-transform',
  'scene',
  'scene-motion',
  'typed-events',
  'ui-components',
  'ui-layout',
  'ui-masks',
  'ui-nine-slice',
  'ui-text',
] as const;
export type RuntimeFeature = (typeof RUNTIME_FEATURES)[number];
export type RuntimeLogicGraph = Omit<LogicGraph, 'states'> & {
  states: Omit<LogicGraph['states'][number], 'position'>[];
};
export type RuntimeNode =
  | Exclude<SceneNode, { type: 'rig' }>
  | (Omit<Extract<SceneNode, { type: 'rig' }>, 'logic'> & { logic?: RuntimeLogicGraph });
export interface RuntimeSceneClip {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  tracks: {
    nodeId: string;
    property: SceneProperty;
    keys: { time: number; value: number; curve: Curve }[];
  }[];
  events: { time: number; name: string; payload?: EventPayload }[];
}
export type RuntimeArtboard = Omit<Artboard, 'nodes' | 'clips' | 'logic'> & {
  nodes: RuntimeNode[];
  clips?: RuntimeSceneClip[];
  logic?: RuntimeLogicGraph;
};
export type RuntimeComponent = Omit<UIComponent, 'revision' | 'nodes'> & { nodes: RuntimeNode[] };
/** Independent image records; no source filenames, editor registry or original paths. */
export interface RuntimeImageTexture {
  id: string;
  type: 'image';
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
}
export interface RuntimeAtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RuntimeAtlasTexture {
  id: string;
  type: 'atlas';
  pageId: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: RuntimeAtlasRect;
  frame: RuntimeAtlasRect;
  rotated: boolean;
  scale: number;
  empty: boolean;
}
export type RuntimeTexture = RuntimeImageTexture | RuntimeAtlasTexture;
/** One physical image is stored once, even when many logical textures share it. */
export interface RuntimeAtlasPage {
  id: string;
  mime: 'image/png';
  base64: string;
  width: number;
  height: number;
  padding: number;
  premultiplied: false;
}
export interface RuntimeProgram {
  format: typeof RUNTIME_FORMAT;
  version: typeof RUNTIME_VERSION;
  id: string;
  name: string;
  defaultArtboardId: string;
  /** Sorted, exact requirements derived from the program, never trusted as a substitute for validation. */
  features: RuntimeFeature[];
  textures: RuntimeTexture[];
  atlasPages: RuntimeAtlasPage[];
  fonts: EmbeddedFont[];
  artboards: RuntimeArtboard[];
  components: RuntimeComponent[];
}
export interface RuntimeDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  objectId: string | null;
  explanation: string;
  remedy: string;
}
export class RuntimeFormatError extends Error {
  constructor(readonly diagnostic: RuntimeDiagnostic) {
    super(diagnostic.explanation);
    this.name = 'RuntimeFormatError';
  }
}
export function runtimeFail(
  code: string,
  explanation: string,
  objectId: string | null = null,
  remedy = 'Correct the indicated data in the source project and export again.',
): never {
  throw new RuntimeFormatError({ code, severity: 'error', objectId, explanation, remedy });
}
