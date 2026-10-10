import { Container, Graphics, Matrix, Mesh, MeshGeometry, Sprite, Texture } from 'pixi.js';
import { rasterizeUIText, type LocalizationPreview } from './UITextAdapter';
import { RigSceneDisplay } from './RigSceneDisplay';
import {
  evaluateScene,
  inverseSceneMatrix,
  scenePoint,
  Skeleton,
  solveFK,
  solveConstraints,
  updateSkinning,
  expandUIComponents,
  nineSliceGrid,
  safeUIBox,
  type UIComponent,
  type Artboard,
  type SceneTransform,
  type EvaluatedSceneNode,
} from '@limber/core';
import { textureRegistry } from '../engine/TextureRegistry';
const ownedTextures = new WeakMap<Container, Texture>();
interface TextDisplay {
  sprite: Sprite;
  signature: string;
  overflow: boolean;
}
function textSignature(
  node: Extract<Artboard['nodes'][number], { type: 'text' }>,
  box: { width: number; height: number },
  localization: LocalizationPreview,
): string {
  return JSON.stringify([
    node.text,
    node.fontFamilies,
    node.fontSize,
    node.lineHeight,
    node.direction,
    node.align,
    node.color,
    box.width,
    box.height,
    localization,
  ]);
}
function disposeScene(container: Container): void {
  const queue: Container[] = [container];
  for (let i = 0; i < queue.length; i++) {
    const child = queue[i]!;
    if (child instanceof Mesh) child.geometry.destroy();
    ownedTextures.get(child)?.destroy(true);
    queue.push(...child.children);
  }
  container.destroy({ children: true });
}

/** Disposable renderer adapter: no authoring state or command history lives in Pixi. */
function sceneDisplay(
  artboard: Artboard,
  displays: Map<string, Container>,
  overflow: string[],
  localization: LocalizationPreview,
  skeletons: ReadonlyMap<string, Skeleton>,
  rigs: Map<string, RigSceneDisplay>,
  texts: Map<string, TextDisplay>,
): Container {
  const world = new Container();
  world.addChild(
    new Graphics()
      .rect(-artboard.width / 2, -artboard.height / 2, artboard.width, artboard.height)
      .fill(0x20242c)
      .stroke({ color: 0x667085, width: 1 }),
  );
  if (artboard.safeArea) {
    const box = safeUIBox(artboard);
    world.addChild(
      new Graphics()
        .rect(box.x - box.width / 2, box.y - box.height / 2, box.width, box.height)
        .stroke({ color: 0x5ed39b, width: 1 }),
    );
  }
  const clipping = new Map<string, Container>();
  for (const entry of evaluateScene(artboard)) {
    const node = entry.node;
    const container =
      node.type === 'mask'
        ? new Graphics()
            .rect(-entry.box.width / 2, -entry.box.height / 2, entry.box.width, entry.box.height)
            .fill(0xffffff)
        : new Container();
    container.setFromMatrix(new Matrix(...entry.world));
    container.alpha = entry.opacity;
    container.tint = entry.tint;
    container.visible = entry.visible;
    container.label = node.id;
    const parent = node.parentId ? (clipping.get(node.parentId) ?? world) : world;
    if (node.type === 'mask') {
      const wrapper = new Container();
      parent.addChild(wrapper);
      wrapper.addChild(container);
      wrapper.mask = container;
      clipping.set(node.id, wrapper);
    } else {
      parent.addChild(container);
      clipping.set(node.id, parent);
    }
    displays.set(node.id, container);
    if (node.type === 'image') {
      const sprite = new Sprite(textureRegistry.get(node.textureId) ?? textureRegistry.placeholder);
      sprite.anchor.set(0.5);
      sprite.width = entry.box.width;
      sprite.height = entry.box.height;
      container.addChild(sprite);
    } else if (node.type === 'nineSlice') {
      const grid = nineSliceGrid(
        node.sourceWidth,
        node.sourceHeight,
        entry.box.width,
        entry.box.height,
        node.borders,
      );
      const positions: number[] = [],
        uvs: number[] = [],
        indices: number[] = [];
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          positions.push(grid.x[x]!, grid.y[y]!);
          uvs.push(grid.sourceX[x]! / node.sourceWidth, grid.sourceY[y]! / node.sourceHeight);
          if (x < 3 && y < 3) {
            const index = y * 4 + x;
            indices.push(index, index + 1, index + 4, index + 1, index + 5, index + 4);
          }
        }
      container.addChild(
        new Mesh({
          geometry: new MeshGeometry({
            positions: new Float32Array(positions),
            uvs: new Float32Array(uvs),
            indices: new Uint32Array(indices),
          }),
          texture: textureRegistry.get(node.textureId) ?? textureRegistry.placeholder,
        }),
      );
    } else if (node.type === 'shape') {
      container.addChild(
        new Graphics()
          .roundRect(
            -entry.box.width / 2,
            -entry.box.height / 2,
            entry.box.width,
            entry.box.height,
            Math.min(node.radius, entry.box.width / 2, entry.box.height / 2),
          )
          .fill(node.color),
      );
    } else if (node.type === 'text') {
      const rendered = rasterizeUIText(node, entry.box, localization);
      if (rendered.overflow) overflow.push(node.name);
      const texture = Texture.from(rendered.canvas, true),
        sprite = new Sprite(texture);
      ownedTextures.set(sprite, texture);
      sprite.anchor.set(0.5);
      sprite.width = entry.box.width;
      sprite.height = entry.box.height;
      container.addChild(sprite);
      texts.set(node.id, {
        sprite,
        signature: textSignature(node, entry.box, localization),
        overflow: rendered.overflow,
      });
    } else if (node.type === 'rig') {
      const skeleton = skeletons.get(node.id) ?? new Skeleton(node.skeleton);
      if (!skeletons.has(node.id)) {
        solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
        solveConstraints(skeleton);
        updateSkinning(skeleton);
      }
      const display = new RigSceneDisplay(skeleton);
      rigs.set(node.id, display);
      container.addChild(display.container);
    } else if (node.type === 'group' && !node.layout) {
      container.addChild(new Graphics().circle(0, 0, 7).stroke({ color: 0x8b7cff, width: 2 }));
    }
  }
  return world;
}

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SceneRenderer {
  readonly world: Container;
  setScene(artboard: Artboard): void;
  preview(values: Record<string, SceneTransform>, opacity?: Record<string, number>): void;
  highlight(ids: string[], tool: string): void;
  bounds(ids: string[]): SceneBounds | null;
  hitTest(x: number, y: number): string | null;
  destroy(): void;
}

/** Pixi is confined to this adapter; the input is portable authoring data plus transient transforms. */
export class PixiSceneRenderer implements SceneRenderer {
  readonly world = new Container();
  private content = new Container();
  private overlay = new Graphics();
  private artboard: Artboard | null = null;
  private entries: EvaluatedSceneNode[] = [];
  private displays = new Map<string, Container>();
  private selected: string[] = [];
  private tool = 'move';
  private components: UIComponent[] = [];
  private localization: LocalizationPreview = 'expected';
  private rigs = new Map<string, RigSceneDisplay>();
  private texts = new Map<string, TextDisplay>();
  private owners = new Map<string, string>();
  readonly textOverflow: string[] = [];
  rebuilds = 0;
  textRasters = 0;
  setScene(
    artboard: Artboard,
    components: UIComponent[] = [],
    localization: LocalizationPreview = 'expected',
    skeletons: ReadonlyMap<string, Skeleton> = new Map(),
  ): void {
    this.world.removeChild(this.content);
    disposeScene(this.content);
    this.artboard = artboard;
    this.components = components;
    this.localization = localization;
    this.rigs = new Map();
    this.texts = new Map();
    const expanded = expandUIComponents({ components }, artboard);
    this.owners = expanded.owners;
    this.displays = new Map();
    this.textOverflow.length = 0;
    this.content = sceneDisplay(
      expanded.artboard,
      this.displays,
      this.textOverflow,
      localization,
      skeletons,
      this.rigs,
      this.texts,
    );
    this.textRasters += this.texts.size;
    this.world.addChildAt(this.content, 0);
    if (!this.overlay.parent) this.world.addChild(this.overlay);
    this.rebuilds++;
    this.preview({});
  }
  preview(values: Record<string, SceneTransform>, opacity: Record<string, number> = {}): void {
    if (!this.artboard) return;
    const artboard =
      Object.keys(values).length || Object.keys(opacity).length
        ? {
            ...this.artboard,
            nodes: this.artboard.nodes.map((node) =>
              values[node.id] || opacity[node.id] !== undefined
                ? {
                    ...node,
                    transform: values[node.id] ?? node.transform,
                    opacity: opacity[node.id] ?? node.opacity,
                  }
                : node,
            ),
          }
        : this.artboard;
    this.previewView(artboard);
  }
  /** Transient bound view and posed skeletons; geometry survives animation frames. */
  previewView(artboard: Artboard, skeletons?: ReadonlyMap<string, Skeleton>): void {
    const expanded = expandUIComponents({ components: this.components }, artboard);
    this.entries = evaluateScene(expanded.artboard);
    for (const entry of this.entries) {
      const display = this.displays.get(entry.node.id);
      if (!display) continue;
      display.setFromMatrix(new Matrix(...entry.world));
      display.alpha = entry.opacity;
      display.tint = entry.tint;
      display.visible = entry.visible;
      if (entry.node.type === 'text') {
        const cached = this.texts.get(entry.node.id),
          signature = textSignature(entry.node, entry.box, this.localization);
        if (cached && cached.signature !== signature) {
          const rendered = rasterizeUIText(entry.node, entry.box, this.localization),
            texture = Texture.from(rendered.canvas, true);
          ownedTextures.get(cached.sprite)?.destroy(true);
          cached.sprite.texture = texture;
          ownedTextures.set(cached.sprite, texture);
          cached.sprite.width = entry.box.width;
          cached.sprite.height = entry.box.height;
          cached.signature = signature;
          cached.overflow = rendered.overflow;
          this.textRasters++;
        }
      }
    }
    this.textOverflow.length = 0;
    for (const entry of this.entries)
      if (entry.visible && this.texts.get(entry.node.id)?.overflow) this.textOverflow.push(entry.node.name);
    for (const [id, rig] of this.rigs) {
      if (skeletons?.has(id) && skeletons.get(id) !== rig.skeleton)
        throw new Error('Rebuild the renderer after Logic session publication.');
      rig.update();
    }
    this.highlight(this.selected, this.tool);
  }
  bounds(ids: string[]): SceneBounds | null {
    const included = new Set(ids);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const entry of this.entries) {
      if (entry.node.parentId && included.has(entry.node.parentId)) included.add(entry.node.id);
      if (!included.has(entry.node.id) || !entry.visible) continue;
      const display = this.displays.get(entry.node.id);
      if (!display) continue;
      const rect = display.getLocalBounds();
      for (const [x, y] of [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x, rect.y + rect.height],
        [rect.x + rect.width, rect.y + rect.height],
      ]) {
        const p = scenePoint(entry.world, x!, y!);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  }
  pivot(ids: string[]): { x: number; y: number } | null {
    if (ids.length === 1) {
      const entry = this.entries.find((entry) => entry.node.id === ids[0]);
      if (entry) return scenePoint(entry.world, entry.node.transform.pivotX, entry.node.transform.pivotY);
    }
    const bounds = this.bounds(ids);
    return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null;
  }
  highlight(ids: string[], tool: string): void {
    this.selected = ids;
    this.tool = tool;
    this.overlay.clear();
    const rect = this.bounds(ids);
    if (!rect) return;
    const scale = Math.max(this.world.scale.x, 0.001),
      width = 1.5 / scale;
    this.overlay
      .rect(rect.x, rect.y, Math.max(rect.width, 1), Math.max(rect.height, 1))
      .stroke({ color: 0x8b7cff, width });
    const pivot = this.pivot(ids)!;
    this.overlay
      .circle(pivot.x, pivot.y, 5 / scale)
      .fill(0xffffff)
      .stroke({ color: 0x8b7cff, width });
    if (tool === 'move') {
      this.overlay
        .moveTo(pivot.x, pivot.y)
        .lineTo(pivot.x + 50 / scale, pivot.y)
        .stroke({ color: 0xff6b7a, width: 3 / scale });
      this.overlay
        .moveTo(pivot.x, pivot.y)
        .lineTo(pivot.x, pivot.y + 50 / scale)
        .stroke({ color: 0x5ed39b, width: 3 / scale });
    } else if (tool === 'rotate')
      this.overlay.circle(pivot.x, pivot.y, 45 / scale).stroke({ color: 0xf7c85b, width: 2 / scale });
    else if (tool === 'scale')
      this.overlay
        .rect(rect.x + rect.width - 4 / scale, rect.y + rect.height - 4 / scale, 8 / scale, 8 / scale)
        .fill(0xf7c85b);
  }
  hitTest(x: number, y: number): string | null {
    const byId = new Map(this.entries.map((entry) => [entry.node.id, entry]));
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (!entry.visible || entry.opacity <= 0) continue;
      const display = this.displays.get(entry.node.id);
      if (!display) continue;
      try {
        let parentId = entry.node.parentId,
          clipped = false;
        while (parentId) {
          const parent = byId.get(parentId)!;
          if (parent.node.type === 'mask') {
            const local = scenePoint(inverseSceneMatrix(parent.world), x, y);
            if (Math.abs(local.x) > parent.box.width / 2 || Math.abs(local.y) > parent.box.height / 2) {
              clipped = true;
              break;
            }
          }
          parentId = parent.node.parentId;
        }
        if (clipped) continue;
        const p = scenePoint(inverseSceneMatrix(entry.world), x, y),
          rect = display.getLocalBounds();
        if (p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.width && p.y <= rect.y + rect.height)
          return this.owners.get(entry.node.id) ?? entry.node.id;
      } catch {
        /* Singular nodes cannot be picked through inverse coordinates. */
      }
    }
    return null;
  }
  inspectRigs() {
    return [...this.rigs].map(([id, rig]) => ({ id, ...rig.inspect() }));
  }
  inspectView() {
    return this.entries.map((entry) => ({
      id: entry.node.id,
      type: entry.node.type,
      visible: this.displays.get(entry.node.id)?.visible ?? false,
      renderedText: this.texts.has(entry.node.id)
        ? (JSON.parse(this.texts.get(entry.node.id)!.signature) as unknown[])[0]
        : undefined,
    }));
  }
  destroy(): void {
    disposeScene(this.content);
    this.overlay.destroy();
    this.world.destroy();
  }
}
