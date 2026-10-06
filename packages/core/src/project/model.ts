import type { Animation } from '../types/animation';
import type { SkeletonData, Transform } from '../types/data';
import type { AssetManifest, EditorDocument } from '../types/document';
import { uuid } from '../utils/uuid';

export const PROJECT_FORMAT = 'bonebybone-project' as const;
export const PROJECT_SCHEMA_VERSION = 1;

export interface SceneTransform extends Transform {
  /** Local-space pivot in pixels; independent of the node's dimensions. */
  pivotX: number;
  pivotY: number;
}

export interface SceneNodeBase {
  id: string;
  name: string;
  parentId: string | null;
  transform: SceneTransform;
  opacity: number;
  visible: boolean;
}

export interface GroupNode extends SceneNodeBase {
  type: 'group';
}
export interface ImageNode extends SceneNodeBase {
  type: 'image';
  textureId: string;
  width: number;
  height: number;
}
export interface RigNode extends SceneNodeBase {
  type: 'rig';
  skeleton: SkeletonData;
  animations: Animation[];
}
export type SceneNode = GroupNode | ImageNode | RigNode;

export interface Artboard {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Array order is draw order among siblings. Parent relationships use IDs. */
  nodes: SceneNode[];
}

/** Authoring contract; this is deliberately NOT the shipping runtime format. */
export interface BoneByBoneProject {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  projectId: string;
  name: string;
  artboards: Artboard[];
  assetManifest: AssetManifest;
  editor: { activeArtboardId: string; activeRigId: string | null };
}

export function sceneTransform(): SceneTransform {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, pivotX: 0, pivotY: 0 };
}

/** One-time migration: clone the source, keeping all existing rig/asset references intact. */
export function projectFromLegacy(doc: EditorDocument, name = 'Untitled'): BoneByBoneProject {
  const source = structuredClone(doc);
  const artboardId = uuid();
  const rigId = uuid();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: uuid(),
    name,
    artboards: [
      {
        id: artboardId,
        name: 'Character',
        width: 1920,
        height: 1080,
        nodes: [
          {
            id: rigId,
            name: 'Character rig',
            type: 'rig',
            parentId: null,
            transform: sceneTransform(),
            opacity: 1,
            visible: true,
            skeleton: source.skeleton,
            animations: source.animations,
          },
        ],
      },
    ],
    assetManifest: source.assetManifest,
    editor: { activeArtboardId: artboardId, activeRigId: rigId },
  };
}

/** The legacy editor sees a reference-backed view, never a second copy of the rig. */
export function activeRigDocument(project: BoneByBoneProject): EditorDocument | null {
  const artboard = project.artboards.find((a) => a.id === project.editor.activeArtboardId);
  const rig = artboard?.nodes.find(
    (n): n is RigNode => n.type === 'rig' && n.id === project.editor.activeRigId,
  );
  return rig
    ? { skeleton: rig.skeleton, animations: rig.animations, assetManifest: project.assetManifest }
    : null;
}
