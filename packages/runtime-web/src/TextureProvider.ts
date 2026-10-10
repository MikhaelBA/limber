import type { Texture } from 'pixi.js';

/** Explicit resource ownership: rendering never reaches an editor/global asset registry. */
export interface TextureProvider {
  readonly version: number;
  readonly placeholder: Texture;
  get(id: string): Texture | undefined;
}
