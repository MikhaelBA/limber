import {
  Mesh,
  MeshGeometry,
  Shader,
  Buffer,
  BufferUsage,
  Container,
  type Graphics,
  compileHighShaderGlProgram,
  localUniformBitGl,
  colorBitGl,
  roundPixelsBitGl,
} from 'pixi.js';
import { decodeWeights } from '@limber/mesh';
import type { AttachmentData, Skeleton } from '@limber/core';
import { useWeightEditingStore, weightColor } from '../store/weightEditingStore';
import { useEditorStore } from '../store/editorStore';

/** Vertex colors are interpolated by the GPU, including black filtered influences. */
export class WeightVisuals {
  readonly container = new Container();
  private overlay: Mesh<MeshGeometry, Shader> | null = null;
  private triangles: readonly number[] | null = null;
  hide(): void {
    if (this.overlay) this.overlay.visible = false;
  }
  draw(
    g: Graphics,
    attachment: AttachmentData,
    skeleton: Skeleton,
    verts: Float32Array,
    fallback: number,
    scale: number,
  ): void {
    const ui = useWeightEditingStore.getState(),
      st = useEditorStore.getState(),
      count = verts.length / 2;
    const rows = decodeWeights(
      attachment.weights ?? Array(count).fill(0),
      count,
      skeleton.data.bones.length,
    ).map((row) => (row.length ? row : [{ boneIndex: fallback, weight: 1 }]));
    const bound = attachment.boneBindings?.map((b) => skeleton.boneIndexMap.get(b.boneId)!) ?? [fallback];
    const selectedBones = new Set(
      (ui.bones.includes(st.weightBoneId ?? '') ? ui.bones : st.weightBoneId ? [st.weightBoneId] : []).map(
        (id) => skeleton.boneIndexMap.get(id)!,
      ),
    );
    const selectedVertices = new Set(ui.vertices),
      triangles = attachment.meshTriangles ?? [];
    if (ui.overlay && triangles.length) {
      if (
        !this.overlay ||
        this.overlay.geometry.positions.length !== verts.length ||
        this.overlay.geometry.indices.length !== triangles.length
      ) {
        if (this.overlay) {
          this.container.removeChild(this.overlay);
          this.overlay.geometry.destroy();
          this.overlay.shader?.destroy();
          this.overlay.destroy();
        }
        const geometry = new MeshGeometry({
          positions: new Float32Array(verts.length),
          uvs: new Float32Array(verts.length),
          indices: new Uint32Array(triangles),
        });
        geometry.addAttribute('aColor', {
          buffer: new Buffer({
            data: new Float32Array(count * 4),
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
          }),
          format: 'float32x4',
        });
        const shader = new Shader({
          glProgram: compileHighShaderGlProgram({
            name: 'weights-overlay',
            bits: [
              localUniformBitGl,
              colorBitGl,
              roundPixelsBitGl,
              { name: 'solid', fragment: { main: 'outColor = vec4(1.);' } },
            ],
          }),
          resources: {},
        });
        this.overlay = new Mesh({ geometry, shader });
        this.overlay.alpha = 0.65;
        this.container.addChild(this.overlay);
        this.triangles = triangles;
      }
      this.overlay.visible = true;
      this.overlay.geometry.positions.set(verts);
      this.overlay.geometry.getBuffer('aPosition').update();
      if (this.triangles !== triangles) {
        this.overlay.geometry.indices = new Uint32Array(triangles);
        this.triangles = triangles;
      }
      const colors = this.overlay.geometry.getBuffer('aColor').data as Float32Array;
      rows.forEach((row, vertex) => {
        let red = 0,
          green = 0,
          blue = 0;
        for (const item of row) {
          const color =
            ui.selectedOnly && !selectedBones.has(item.boneIndex)
              ? 0
              : weightColor(Math.max(0, bound.indexOf(item.boneIndex)));
          red += (((color >> 16) & 255) / 255) * item.weight;
          green += (((color >> 8) & 255) / 255) * item.weight;
          blue += ((color & 255) / 255) * item.weight;
        }
        colors.set([red, green, blue, 1], vertex * 4);
      });
      this.overlay.geometry.getBuffer('aColor').update();
    }
    rows.forEach((row, vertex) => {
      const selected = selectedVertices.has(vertex);
      if (
        ui.selectedOnly &&
        !selected &&
        !row.some((item) => selectedBones.has(item.boneIndex) && item.weight > 0)
      )
        return;
      const x = verts[vertex * 2]!,
        y = verts[vertex * 2 + 1]!,
        radius = (selected ? 7 : 4.5) / scale;
      if (ui.pies) {
        let angle = -Math.PI / 2;
        for (const item of row) {
          const end = angle + item.weight * Math.PI * 2;
          g.moveTo(x, y)
            .arc(x, y, radius, angle, end)
            .lineTo(x, y)
            .fill({ color: weightColor(Math.max(0, bound.indexOf(item.boneIndex))) });
          angle = end;
        }
      } else g.circle(x, y, radius).fill({ color: selected ? 0xffffff : 0x9cc7ff });
      if (selected) g.circle(x, y, radius).stroke({ color: 0xffffff, width: 1.5 / scale });
    });
  }
}
