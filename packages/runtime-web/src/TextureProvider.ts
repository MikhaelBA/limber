import type { Texture, Mesh, MeshGeometry } from 'pixi.js';

/** Explicit resource ownership: rendering never reaches an editor/global asset registry. */
export interface TextureProvider {
  readonly version: number;
  readonly placeholder: Texture;
  get(id: string): Texture | undefined;
  /** Optional atlas sampler adaptation. Ordinary full-domain meshes retain batching. */
  configureMesh?(mesh: Mesh<MeshGeometry>): void;
  /** Resolve publication-local font aliases without changing authored family order. */
  resolveFontFamilies?(families: readonly string[]): string[];
}
