/**
 * Document types — what gets saved/loaded/exported (DESIGN.md §3.4).
 */
import type { SkeletonData } from './data';
import type { Animation } from './animation';

export interface TextureMeta {
  name: string;
  /** 'embedded' until Phase 8 atlas packing, then 'atlas' with a region. */
  source: 'embedded' | 'atlas';
  /** Atlas region — populated in Phase 8 when packing. */
  region?: { x: number; y: number; width: number; height: number; rotated?: boolean };
  /**
   * Self-contained projects (v2, additive): the texture pixels as a data URL.
   * Written by the editor's Save when the pixels are still in the registry;
   * on Open, textures re-register from here — no re-dropping images.
   */
  dataUrl?: string;
}

export type AssetManifest = Record<string, TextureMeta>;

/** The in-editor document (no version — versioning belongs to the file format). */
export interface EditorDocument {
  skeleton: SkeletonData;
  animations: Animation[];
  assetManifest: AssetManifest;
}

/** The serialized form: same as EditorDocument plus the format version. */
export interface ExportedDocument extends EditorDocument {
  version: number;
}
