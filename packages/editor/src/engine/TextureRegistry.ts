import { Texture } from 'pixi.js';
import { uuid } from '@limber/core';

export interface LoadedTexture {
  textureId: string;
  name: string;
  width: number;
  height: number;
}

/**
 * In-editor texture registry (DESIGN.md §3.5): maps textureId -> live Pixi
 * texture, loaded from dropped files via `URL.createObjectURL` (local origin,
 * no CORS issues). The document only records textureId -> TextureMeta in
 * `assetManifest`; the pixels themselves are never serialized (Phase 8 bakes
 * an atlas on export).
 *
 * Deliberately OUTSIDE EditorEngine, which stays DOM/Pixi-free so commands and
 * unit tests run in plain Node. This module is browser-only.
 */
export class TextureRegistry {
  private textures = new Map<string, Texture>();
  private urls = new Map<string, string>();
  /** Bumped on every mutation — the viewport reconciles meshes on change. */
  version = 0;

  get(id: string): Texture | undefined {
    return this.textures.get(id);
  }

  has(id: string): boolean {
    return this.textures.has(id);
  }

  /** 1×1 white — used when a textureId has manifest metadata but no pixels. */
  readonly placeholder = Texture.WHITE;

  /**
   * Loads an image File into the registry. Rejects on decode failure (and
   * revokes the object URL — leaking GPU textures/URLs eventually kills the
   * tab, DESIGN.md §8.2).
   */
  async loadFile(file: File): Promise<LoadedTexture> {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Could not decode image "${file.name}".`));
        img.src = url;
      });
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    const textureId = uuid();
    // skipCache=true: this registry owns the texture's lifecycle, not the
    // global pixi asset Cache (which would fight destroy() in clear()).
    const texture = Texture.from(img, true);
    this.textures.set(textureId, texture);
    this.urls.set(textureId, url);
    this.version++;
    return { textureId, name: file.name, width: img.naturalWidth, height: img.naturalHeight };
  }

  /** Frees everything (document replaced) — destroys GPU state, revokes URLs. */
  clear(): void {
    for (const tex of this.textures.values()) tex.destroy(true);
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.textures.clear();
    this.urls.clear();
    this.version++;
  }
}

/** One registry per app process — textures are shared across viewports. */
export const textureRegistry = new TextureRegistry();
