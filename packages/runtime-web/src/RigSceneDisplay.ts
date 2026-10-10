import { Container, Graphics, Mesh, MeshGeometry } from 'pixi.js';
import type { Skeleton, AttachmentData } from '@limber/core';
import type { TextureProvider } from './TextureProvider';
/** Slot geometry caches survive frames and switches; publication owns disposal. */
export class RigSceneDisplay {
  readonly container = new Container();
  private readonly attachments: Map<string, AttachmentData>;
  private readonly meshes = new Map<string, Mesh<MeshGeometry>>();
  private readonly clips = new Map<string, Graphics>();
  private readonly bones: Graphics;
  private readonly slots = new Map<string, Container>();
  private textureVersion = -1;
  constructor(
    readonly skeleton: Skeleton,
    private readonly textures: TextureProvider,
    private readonly debugBones = false,
  ) {
    this.attachments = new Map(skeleton.data.attachments.map((a) => [a.id, a]));
    this.container.sortableChildren = true;
    for (const slot of skeleton.data.slots) {
      const holder = new Container();
      holder.label = slot.id;
      this.slots.set(slot.id, holder);
      this.container.addChild(holder);
      const clip = new Graphics();
      clip.includeInBuild = false;
      this.clips.set(slot.id, clip);
      holder.addChild(clip);
      const ids = [slot.defaultAttachmentId, ...skeleton.data.skins.map((skin) => skin.attachments[slot.id])];
      for (const id of new Set(ids)) {
        const attachment = id ? this.attachments.get(id) : undefined;
        if (attachment) this.mesh(slot.id, attachment);
      }
    }
    this.bones = new Graphics();
    this.container.addChild(this.bones);
    this.update();
  }
  private mesh(slotId: string, attachment: AttachmentData): Mesh<MeshGeometry> | null {
    if (attachment.type !== 'region' && attachment.type !== 'mesh') return null;
    const key = JSON.stringify([slotId, attachment.id]),
      existing = this.meshes.get(key);
    if (existing) return existing;
    const state = this.skeleton.pose.attachments.get(attachment.id);
    if (!state) return null;
    const mesh = new Mesh({
      geometry: new MeshGeometry({
        positions: new Float32Array(state.verts.length),
        uvs: new Float32Array(
          attachment.type === 'region'
            ? (attachment.uvs ?? [0, 0, 1, 0, 1, 1, 0, 1])
            : (attachment.meshUVs ?? []),
        ),
        indices: new Uint32Array(
          attachment.type === 'region' ? [0, 1, 2, 0, 2, 3] : (attachment.meshTriangles ?? []),
        ),
      }),
      texture: this.textures.get(attachment.textureId) ?? this.textures.placeholder,
    });
    this.textures.configureMesh?.(mesh);
    mesh.label = attachment.id;
    mesh.visible = false;
    this.meshes.set(key, mesh);
    this.slots.get(slotId)!.addChild(mesh);
    return mesh;
  }
  update(): void {
    const { data, pose } = this.skeleton;
    if (this.textureVersion !== this.textures.version) {
      for (const mesh of this.meshes.values()) {
        mesh.texture =
          this.textures.get(this.attachments.get(mesh.label)!.textureId) ?? this.textures.placeholder;
        this.textures.configureMesh?.(mesh);
      }
      this.textureVersion = this.textures.version;
    }
    for (const mesh of this.meshes.values()) {
      mesh.visible = false;
    }
    for (const clip of this.clips.values()) clip.clear();
    let activeClip: Graphics | null = null,
      endSlot: string | undefined;
    for (let order = 0; order < pose.slotOrder.length; order++) {
      const index = pose.slotOrder[order]!,
        slot = data.slots[index]!,
        slotPose = pose.slots[index]!;
      this.slots.get(slot.id)!.zIndex = order;
      if (slot.id === endSlot) {
        activeClip = null;
        endSlot = undefined;
      }
      const attachment = slotPose.attachmentId ? this.attachments.get(slotPose.attachmentId) : undefined,
        state = attachment ? pose.attachments.get(attachment.id) : undefined;
      if (!attachment || !state) continue;
      if (attachment.type === 'clipping') {
        activeClip = this.clips.get(slot.id)!;
        activeClip.poly(Array.from(state.verts)).fill(0xffffff);
        endSlot = attachment.endSlotId ?? undefined;
      } else {
        const mesh = this.mesh(slot.id, attachment);
        if (!mesh) continue;
        mesh.geometry.positions.set(state.verts);
        mesh.geometry.getBuffer('aPosition').update();
        mesh.tint = slotPose.color >>> 8;
        mesh.alpha = (slotPose.color & 0xff) / 255;
        mesh.blendMode = slot.blendMode === 'add' ? 'add' : 'normal';
        mesh.mask = activeClip;
        mesh.visible = true;
      }
    }
    // Stencil masks must be renderable, but never enter the ordinary color pass.
    // Removing a mask effect can restore includeInBuild, including on unused clips.
    for (const clip of this.clips.values()) clip.includeInBuild = false;
    this.bones.clear();
    if (this.debugBones && !data.slots.length)
      data.bones.forEach((bone, index) => {
        const m = pose.worldMatrices,
          o = index * 6;
        this.bones
          .moveTo(m[o + 4]!, m[o + 5]!)
          .lineTo(m[o + 4]! + m[o]! * bone.length, m[o + 5]! + m[o + 1]! * bone.length)
          .stroke({ color: 0x54c7ec, width: 5 });
      });
  }
  /** Read-only on-demand browser evidence; no per-frame copies. */
  inspect() {
    return {
      matrices: Array.from(this.skeleton.pose.worldMatrices),
      meshes: [...this.meshes]
        .filter(([, mesh]) => mesh.visible)
        .map(([key, mesh]) => ({
          key,
          attachmentId: mesh.label,
          positions: Array.from(mesh.geometry.positions),
          tint: mesh.tint,
          alpha: mesh.alpha,
          masked: Boolean(mesh.mask),
        })),
      geometryCount: this.meshes.size,
    };
  }
}
