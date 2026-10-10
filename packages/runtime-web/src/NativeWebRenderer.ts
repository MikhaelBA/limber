import type { Container } from 'pixi.js';
import type { Skeleton } from '@limber/core';
import type { NativeArtboardPlayer } from '@limber/runtime';
import { PixiSceneRenderer } from './SceneRenderer';
import { NativeWebAssets } from './NativeWebAssets';

/** Host owns Pixi Application/camera and asset disposal; this adapter owns scene GPU geometry. */
export class NativeWebRenderer {
  readonly world: Container;
  private readonly renderer: PixiSceneRenderer;
  private readonly ids: readonly string[];
  private readonly skeletons = new Map<string, Skeleton>();
  private layout = '';
  private disposed = false;
  constructor(
    readonly player: NativeArtboardPlayer,
    readonly assets: NativeWebAssets,
  ) {
    if (assets.asset !== player.asset)
      throw new Error('Web assets and player must use the same validated asset.');
    if (assets.isDisposed) throw new Error('Native Web assets have been disposed.');
    this.renderer = new PixiSceneRenderer(assets, { expanded: true });
    this.world = this.renderer.world;
    this.ids = player.getRigIds();
    try {
      this.sync();
    } catch (error) {
      this.renderer.destroy();
      throw error;
    }
  }
  sync(): void {
    this.requireLive();
    const view = this.player.getView(),
      layout = JSON.stringify([view.width, view.height, view.safeArea]);
    let rebuild = layout !== this.layout;
    for (const id of this.ids) {
      const skeleton = this.player.getRig(id).skeleton;
      if (this.skeletons.get(id) !== skeleton) {
        this.skeletons.set(id, skeleton);
        rebuild = true;
      }
    }
    if (rebuild) {
      this.renderer.setScene(view, [], 'expected', this.skeletons);
      this.layout = layout;
    } else this.renderer.previewView(view, this.skeletons);
  }
  update(delta: number): number {
    this.requireLive();
    try {
      return this.player.update(delta);
    } finally {
      this.sync();
    }
  }
  step(): number {
    this.requireLive();
    try {
      return this.player.step();
    } finally {
      this.sync();
    }
  }
  private requireLive(): void {
    if (this.disposed || this.assets.isDisposed)
      throw new Error('Native Web renderer/assets have been disposed.');
  }
  hitTest(x: number, y: number): string | null {
    this.requireLive();
    return this.renderer.hitTest(x, y);
  }
  inspect() {
    return {
      rebuilds: this.renderer.rebuilds,
      textRasters: this.renderer.textRasters,
      textOverflow: [...this.renderer.textOverflow],
      rigs: this.renderer.inspectRigs(),
      view: this.renderer.inspectView(),
    };
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.destroy();
  }
}
