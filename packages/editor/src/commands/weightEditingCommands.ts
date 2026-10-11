import {
  decodeWeights,
  encodeWeights,
  editInfluences,
  mergeLockedInfluences,
  pruneInfluences,
  normalizeInfluences,
  validateWeights,
  type Influence,
  type PruneOptions,
} from '@limber/mesh';
import { updateSkinning, weightAttachment } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { MeshEditCommand } from './meshCommands';
import type { SkeletonData } from '@limber/core';
import { relativeAffine } from '@limber/mesh';

export function weightContext(engine: EditorEngine, attachmentId: string) {
  const mesh = weightAttachment(engine.skeleton.data, attachmentId);
  if (!mesh?.meshVertices) throw new Error('Select a weighted attachment.');
  const path = engine.skeleton.data.paths?.find((item) => item.id === attachmentId);
  const slot = path
    ? { id: path.id, name: path.name, boneId: path.boneId, defaultAttachmentId: path.id, color: 0xffffffff }
    : engine.skeleton.data.slots.find(
        (item) =>
          item.defaultAttachmentId === attachmentId ||
          engine.skeleton.pose.slots[engine.skeleton.slotIndexMap.get(item.id)!]?.attachmentId ===
            attachmentId ||
          engine.skeleton.data.skins.some((skin) => skin.attachments[item.id] === attachmentId) ||
          engine.document.animations.some((clip) =>
            clip.timelines.some(
              (track) =>
                track.kind === 'slotAttachment' &&
                track.slotId === item.id &&
                track.keyframes.some((key) => key.attachmentId === attachmentId),
            ),
          ),
      );
  if (!slot) throw new Error('Attachment needs a slot.');
  const fallback = engine.skeleton.boneIndexMap.get(slot.boneId)!;
  const count = mesh.meshVertices.length / 2;
  const rows = decodeWeights(
    mesh.weights ?? Array(count).fill(0),
    count,
    engine.skeleton.data.bones.length,
  ).map((row) => (row.length ? row : [{ boneIndex: fallback, weight: 1 }]));
  const locked = new Set((mesh.weightLocks ?? []).map((id) => engine.skeleton.boneIndexMap.get(id)!));
  return { mesh, slot, fallback, count, rows, locked };
}

export function weightRowsCommand(
  engine: EditorEngine,
  id: string,
  rows: readonly (readonly Influence[])[],
  label: string,
): Command {
  const mesh = weightContext(engine, id).mesh,
    next = encodeWeights(rows),
    previous = mesh.weights?.slice();
  const boneIds = engine.skeleton.data.bones.map((b) => b.id).join(':');
  let ready = false;
  const apply = (weights: number[] | undefined) => {
    const current = weightContext(engine, id);
    if (boneIds !== engine.skeleton.data.bones.map((b) => b.id).join(':'))
      throw new Error('Weight bone order changed.');
    validateWeights(
      weights,
      current.count,
      engine.skeleton.data.bones.length,
      current.mesh.boneBindings
        ? new Set(current.mesh.boneBindings.map((b) => engine.skeleton.boneIndexMap.get(b.boneId)!))
        : undefined,
    );
    current.mesh.weights = weights?.slice();
  };
  return {
    label,
    do: () => {
      if (!ready && JSON.stringify(weightContext(engine, id).mesh.weights) !== JSON.stringify(previous))
        throw new Error('Attachment weights changed.');
      apply(next);
      ready = true;
    },
    undo: () => {
      apply(previous);
    },
  };
}

/** One history entry for a direct drag, independent of playback and keyframe authoring. */
export class DirectWeightsCommand implements Command {
  readonly label = 'Direct weights';
  private before: number[] | undefined;
  private after: number[] | undefined;
  private original: Influence[][] = [];
  constructor(
    private engine: EditorEngine,
    private attachmentId: string,
    private vertices: number[],
    private bones: string[],
  ) {}
  open(): void {
    const context = weightContext(this.engine, this.attachmentId);
    this.before = context.mesh.weights?.slice();
    this.original = context.rows;
  }
  update(amount: number, relative = false): void {
    const { mesh, fallback, locked, count } = weightContext(this.engine, this.attachmentId);
    const selected = new Set(
      this.bones.map((id) => {
        if (!mesh.boneBindings?.some((binding) => binding.boneId === id))
          throw new Error('Select bound bones.');
        return this.engine.skeleton.boneIndexMap.get(id)!;
      }),
    );
    const rows = this.original.map((row) => row.map((item) => ({ ...item })));
    for (const vertex of this.vertices) {
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= count)
        throw new Error('Vertex selection is stale.');
      const current = rows[vertex]!.reduce(
        (sum, item) => sum + (selected.has(item.boneIndex) && !locked.has(item.boneIndex) ? item.weight : 0),
        0,
      );
      rows[vertex] = editInfluences(
        rows[vertex]!,
        selected,
        relative ? current + amount : amount,
        locked,
        fallback,
      );
    }
    mesh.weights = encodeWeights(rows);
  }
  commit(): void {
    this.after = weightAttachment(this.engine.skeleton.data, this.attachmentId)!.weights?.slice();
  }
  get changed(): boolean {
    return JSON.stringify(this.before) !== JSON.stringify(this.after);
  }
  do(): void {
    weightAttachment(this.engine.skeleton.data, this.attachmentId)!.weights = this.after?.slice();
  }
  undo(): void {
    weightAttachment(this.engine.skeleton.data, this.attachmentId)!.weights = this.before?.slice();
  }
}

export function prunePreview(engine: EditorEngine, id: string, vertices: number[], options: PruneOptions) {
  const { rows, locked } = weightContext(engine, id),
    selection = new Set(vertices);
  let removed = 0,
    affected = 0;
  const result = rows.map((row, vertex) => {
    if (selection.size && !selection.has(vertex)) return row;
    const next = pruneInfluences(row, options, locked);
    const delta = row.length - next.length;
    removed += delta;
    if (delta) affected++;
    return next;
  });
  return { rows: result, removed, affected };
}

export function swapWeights(engine: EditorEngine, id: string, vertices: number[], bones: string[]): Command {
  if (bones.length !== 2) throw new Error('Select exactly two bound bones to swap.');
  const { rows, locked, mesh } = weightContext(engine, id);
  if (bones.some((id) => !mesh.boneBindings?.some((binding) => binding.boneId === id)))
    throw new Error('Select exactly two bound bones to swap.');
  const [a, b] = bones.map((bone) => engine.skeleton.boneIndexMap.get(bone)!);
  if (locked.has(a!) || locked.has(b!)) throw new Error('Unlock the selected bones before swapping.');
  const selected = new Set(vertices);
  return weightRowsCommand(
    engine,
    id,
    rows.map((row, v) =>
      selected.size && !selected.has(v)
        ? row
        : row.map((item) => ({
            ...item,
            boneIndex: item.boneIndex === a ? b! : item.boneIndex === b ? a! : item.boneIndex,
          })),
    ),
    'Swap weights',
  );
}

export class WeightMetadataCommand extends MeshEditCommand {
  readonly label: string;
  constructor(
    engine: EditorEngine,
    private id: string,
    private action: 'lock' | 'order' | 'remove',
    private bones: string[],
  ) {
    super(engine);
    this.label =
      action === 'lock' ? 'Lock weights' : action === 'order' ? 'Reorder weight bones' : 'Unbind bones';
  }
  protected edit(data: SkeletonData): void {
    const mesh = weightAttachment(data, this.id)!;
    if (!mesh?.meshVertices || !mesh.boneBindings) throw new Error('Select a bound mesh.');
    if (this.action === 'lock') {
      mesh.weightLocks = [...this.bones];
      return;
    }
    if (this.action === 'order') {
      if (this.bones.length !== mesh.boneBindings.length || new Set(this.bones).size !== this.bones.length)
        throw new Error('Invalid bone order.');
      mesh.boneBindings = this.bones.map((id) => {
        const binding = mesh.boneBindings!.find((item) => item.boneId === id);
        if (!binding) throw new Error('Missing binding.');
        return binding;
      });
      return;
    }
    const removed = new Set(this.bones.map((id) => data.bones.findIndex((bone) => bone.id === id)));
    mesh.boneBindings = mesh.boneBindings.filter((binding) => !this.bones.includes(binding.boneId));
    mesh.weightLocks = mesh.weightLocks?.filter((id) => !this.bones.includes(id));
    if (!mesh.boneBindings.length) {
      mesh.boneBindings = undefined;
      mesh.weights = undefined;
      mesh.weightLocks = undefined;
      return;
    }
    const remaining = data.bones.findIndex((bone) => bone.id === mesh.boneBindings![0]!.boneId);
    mesh.weights = encodeWeights(
      decodeWeights(
        mesh.weights ?? Array(mesh.meshVertices.length / 2).fill(0),
        mesh.meshVertices.length / 2,
        data.bones.length,
      ).map((row) => {
        const kept = normalizeInfluences(row.filter((item) => !removed.has(item.boneIndex)));
        return kept.length ? kept : [{ boneIndex: remaining, weight: 1 }];
      }),
    );
  }
}

/** Bake the current visible shape and capture current bone matrices as the new binding. */
export class UpdateBindingsCommand extends MeshEditCommand {
  readonly label = 'Update bindings';
  constructor(
    engine: EditorEngine,
    private id: string,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to update bindings.');
    const { mesh, slot, fallback } = weightContext(this.engine, this.id);
    if (mesh.meshSourceId || data.attachments.some((item) => item.meshSourceId === mesh.id))
      throw new Error('Make shared geometry independent before updating bindings.');
    updateSkinning(this.engine.skeleton);
    const verts = weightWorldVertices(this.engine, this.id),
      wm = this.engine.skeleton.pose.worldMatrices;
    const slotWorld = wm.subarray(fallback * 6, fallback * 6 + 6);
    const inverse = relativeAffine(slotWorld, [1, 0, 0, 1, 0, 0]);
    const target = weightAttachment(data, this.id)!;
    target.meshVertices = Array.from(verts, (value, i) => {
      const offset = i - (i % 2),
        x = verts[offset]!,
        y = verts[offset + 1]!;
      return i % 2
        ? inverse[1]! * x + inverse[3]! * y + inverse[5]!
        : inverse[0]! * x + inverse[2]! * y + inverse[4]!;
    });
    target.boneBindings = mesh.boneBindings?.map((binding) => {
      const index = this.engine.skeleton.boneIndexMap.get(binding.boneId)!;
      return {
        boneId: binding.boneId,
        matrix: relativeAffine(wm.subarray(index * 6, index * 6 + 6), slotWorld),
      };
    });
    void slot;
  }
}

export function pasteWeights(
  engine: EditorEngine,
  id: string,
  vertices: number[],
  copied: { boneId: string; weight: number }[][],
): Command {
  if (!vertices.length || copied.length !== vertices.length)
    throw new Error('Paste requires the same number of selected vertices as Copy.');
  const { mesh, rows, locked, fallback } = weightContext(engine, id);
  vertices.forEach((vertex, index) => {
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= rows.length)
      throw new Error('Vertex selection is stale.');
    const proposed = copied[index]!.map((item) => {
      if (!mesh.boneBindings?.some((binding) => binding.boneId === item.boneId))
        throw new Error('Bind all copied bones before pasting.');
      return { boneIndex: engine.skeleton.boneIndexMap.get(item.boneId)!, weight: item.weight };
    });
    rows[vertex] = mergeLockedInfluences(rows[vertex]!, proposed, locked, fallback);
  });
  return weightRowsCommand(engine, id, rows, 'Paste weights');
}

export function weldWeights(
  engine: EditorEngine,
  targetId: string,
  sourceId: string,
  overlapping: boolean,
): Command {
  if (sourceId === targetId) throw new Error('Choose a different source mesh.');
  const target = weightContext(engine, targetId),
    source = weightContext(engine, sourceId);
  const common = new Set(
    target.mesh.boneBindings
      ?.filter((binding) => source.mesh.boneBindings?.some((item) => item.boneId === binding.boneId))
      .map((binding) => engine.skeleton.boneIndexMap.get(binding.boneId)!) ?? [],
  );
  if (common.size < 2) throw new Error('Weld needs at least two shared bound bones.');
  updateSkinning(engine.skeleton);
  const targetVerts = weightWorldVertices(engine, targetId),
    sourceVerts = weightWorldVertices(engine, sourceId);
  let affected = 0;
  const rows = target.rows.map((row, v) => {
    let closest = -1,
      best = Infinity;
    for (let s = 0; s < source.count; s++) {
      const d = Math.hypot(
        targetVerts[v * 2]! - sourceVerts[s * 2]!,
        targetVerts[v * 2 + 1]! - sourceVerts[s * 2 + 1]!,
      );
      if (d < best) {
        closest = s;
        best = d;
      }
    }
    if (closest < 0 || (overlapping && best > 0.01)) return row;
    const copied = source.rows[closest]!.filter((item) => common.has(item.boneIndex));
    if (!copied.length) return row;
    affected++;
    return mergeLockedInfluences(row, copied, target.locked, target.fallback);
  });
  if (!affected) throw new Error('No matching weld vertices found. Overlapping tolerance is 0.01 rig units.');
  return weightRowsCommand(engine, targetId, rows, `Weld ${affected} vertices`);
}

export class WeightEdgesCommand extends MeshEditCommand {
  readonly label = 'Edit smoothing edges';
  constructor(
    engine: EditorEngine,
    private id: string,
    private vertices: number[],
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    const mesh = data.attachments.find((item) => item.id === this.id)!;
    if (!mesh?.meshVertices || mesh.meshSourceId || this.vertices.length !== 2)
      throw new Error('Select two vertices on independent geometry.');
    const [a, b] = [...this.vertices].sort((x, y) => x - y);
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a! < 0 ||
      b! >= mesh.meshVertices.length / 2 ||
      a === b
    )
      throw new Error('Invalid smoothing edge.');
    const edges = (mesh.weightEdges ??= []);
    for (let i = 0; i < edges.length; i += 2)
      if ((edges[i] === a && edges[i + 1] === b) || (edges[i] === b && edges[i + 1] === a)) {
        edges.splice(i, 2);
        return;
      }
    edges.push(a!, b!);
  }
}

export function weightWorldVertices(engine: EditorEngine, id: string): Float32Array {
  const state = engine.skeleton.pose.attachments.get(id);
  if (state) return state.verts;
  const sampler = engine.skeleton.pathSamplers.get(id);
  if (!sampler) throw new Error('Weighted geometry no longer exists.');
  sampler.updateMetric(
    engine.skeleton.pose.worldMatrices,
    engine.skeleton.boneIndexMap.get(sampler.path.boneId)! * 6,
  );
  return sampler.controlWorld;
}
