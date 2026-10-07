import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Matrix, Mesh, MeshGeometry, Sprite } from 'pixi.js';
import { evaluateScene, Skeleton, solveFK, solveIK, updateSkinning, type Artboard } from '@limber/core';
import { textureRegistry } from '../engine/TextureRegistry';

function disposeScene(container: Container): void {
  const queue: Container[] = [container];
  for (let i = 0; i < queue.length; i++) {
    const child = queue[i]!;
    if (child instanceof Mesh) child.geometry.destroy();
    queue.push(...child.children);
  }
  container.destroy({ children: true });
}

/** Disposable renderer adapter: no authoring state or command history lives in Pixi. */
function sceneDisplay(
  artboard: Artboard,
  selected: string[],
  select: (id: string, add: boolean) => void,
): Container {
  const world = new Container();
  world.addChild(
    new Graphics()
      .rect(-artboard.width / 2, -artboard.height / 2, artboard.width, artboard.height)
      .fill(0x20242c)
      .stroke({ color: 0x667085, width: 1 }),
  );
  for (const entry of evaluateScene(artboard)) {
    const node = entry.node;
    if (!entry.visible) continue;
    const container = new Container();
    container.setFromMatrix(new Matrix(...entry.world));
    container.alpha = entry.opacity;
    world.addChild(container);
    if (node.type === 'image') {
      const sprite = new Sprite(textureRegistry.get(node.textureId) ?? textureRegistry.placeholder);
      sprite.anchor.set(0.5);
      sprite.width = node.width;
      sprite.height = node.height;
      container.addChild(sprite);
    } else if (node.type === 'rig') {
      const skeleton = new Skeleton(node.skeleton);
      solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
      solveIK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
      updateSkinning(skeleton);
      const attachments = new Map(node.skeleton.attachments.map((a) => [a.id, a]));
      let clip: Graphics | null = null;
      let endSlot: string | undefined;
      for (const index of skeleton.pose.slotOrder) {
        const slot = node.skeleton.slots[index]!;
        const pose = skeleton.pose.slots[index]!;
        if (slot.id === endSlot) {
          clip = null;
          endSlot = undefined;
        }
        const attachment = pose.attachmentId ? attachments.get(pose.attachmentId) : undefined;
        const state = attachment ? skeleton.pose.attachments.get(attachment.id) : undefined;
        if (!attachment || !state) continue;
        if (attachment.type === 'clipping') {
          clip = new Graphics().poly(Array.from(state.verts)).fill(0xffffff);
          container.addChild(clip);
          endSlot = attachment.endSlotId ?? undefined;
          continue;
        }
        if (attachment.type !== 'region' && attachment.type !== 'mesh') continue;
        const geometry = new MeshGeometry({
          positions: new Float32Array(state.verts),
          uvs: new Float32Array(
            attachment.type === 'region'
              ? (attachment.uvs ?? [0, 0, 1, 0, 1, 1, 0, 1])
              : (attachment.meshUVs ?? []),
          ),
          indices: new Uint32Array(
            attachment.type === 'region' ? [0, 1, 2, 0, 2, 3] : (attachment.meshTriangles ?? []),
          ),
        });
        const mesh = new Mesh({
          geometry,
          texture: textureRegistry.get(attachment.textureId) ?? textureRegistry.placeholder,
        });
        mesh.tint = pose.color & 0xffffff;
        mesh.alpha = (pose.color >>> 24) / 255;
        mesh.blendMode = slot.blendMode === 'add' ? 'add' : 'normal';
        mesh.mask = clip;
        container.addChild(mesh);
      }
      if (!node.skeleton.slots.length) {
        const bones = new Graphics();
        node.skeleton.bones.forEach((bone, i) => {
          const m = skeleton.pose.worldMatrices,
            o = i * 6;
          bones
            .moveTo(m[o + 4]!, m[o + 5]!)
            .lineTo(m[o + 4]! + m[o]! * bone.length, m[o + 5]! + m[o + 1]! * bone.length)
            .stroke({ color: 0x54c7ec, width: 5 });
        });
        container.addChild(bones);
      }
    } else {
      container.addChild(new Graphics().circle(0, 0, 7).stroke({ color: 0x8b7cff, width: 2 }));
    }
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointerdown', (event) => {
      event.stopPropagation();
      select(node.id, event.shiftKey);
    });
    if (selected.includes(node.id)) {
      const bounds = container.getLocalBounds();
      container.addChild(
        new Graphics()
          .rect(bounds.x - 3, bounds.y - 3, Math.max(bounds.width, 10) + 6, Math.max(bounds.height, 10) + 6)
          .stroke({ color: 0x8b7cff, width: 2 }),
      );
    }
  }
  return world;
}

export function SceneViewport({
  artboard,
  revision,
  selected,
  onSelect,
}: {
  artboard: Artboard;
  revision: number;
  selected: string[];
  onSelect: (id: string, add: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const render = useRef<(() => void) | null>(null);
  const current = useRef({ artboard, selected, onSelect });
  current.current = { artboard, selected, onSelect };
  useEffect(() => {
    const element = host.current!;
    const app = new Application();
    let disposed = false;
    let resize: ResizeObserver | undefined;
    void app
      .init({
        background: 0x151821,
        antialias: true,
        preference: 'webgl',
        resolution: devicePixelRatio,
        autoDensity: true,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        element.appendChild(app.canvas);
        const draw = () => {
          for (const child of app.stage.removeChildren()) disposeScene(child);
          app.renderer.resize(element.clientWidth, element.clientHeight);
          const { artboard, selected, onSelect } = current.current;
          const world = sceneDisplay(artboard, selected, onSelect);
          world.position.set(element.clientWidth / 2, element.clientHeight / 2);
          world.scale.set(
            Math.min(
              (element.clientWidth - 60) / artboard.width,
              (element.clientHeight - 60) / artboard.height,
            ),
          );
          app.stage.addChild(world);
          app.render();
        };
        render.current = draw;
        resize = new ResizeObserver(draw);
        resize.observe(element);
        draw();
      })
      .catch((error: unknown) => {
        if (!disposed) element.textContent = `Scene renderer failed: ${String(error)}`;
      });
    return () => {
      disposed = true;
      render.current = null;
      resize?.disconnect();
      if (app.renderer) {
        for (const child of app.stage.removeChildren()) disposeScene(child);
        app.destroy(true, { children: true });
      }
    };
  }, []);
  useEffect(() => {
    render.current?.();
  }, [artboard, revision, selected]);
  return <div ref={host} data-testid="scene-viewport" className="h-full min-w-0 flex-1 overflow-hidden" />;
}
