import {
  Skeleton,
  solveFK,
  solveConstraints,
  uuid,
  nextPrimaryConstraintOrder,
  type SkeletonData,
  type PathConstraintData,
} from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import { AtomicConstraintCommand } from './rigEdits';
const identity = () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 });
export class AddPathConstraintCommand extends AtomicConstraintCommand {
  readonly label = 'Follow path';
  readonly constraintId = uuid();
  readonly pathId = uuid();
  readonly ownerId = uuid();
  readonly driverId = uuid();
  private readonly chain: string[];
  constructor(
    engine: EditorEngine,
    bones: string[],
    readonly existingPathId: string | null = null,
  ) {
    super(engine);
    this.chain = [...bones];
  }
  protected edit(data: SkeletonData): void {
    const sk = new Skeleton(structuredClone(data));
    solveFK(sk.data, sk.boneIndexMap, sk.pose);
    solveConstraints(sk);
    const root = sk.boneIndexMap.get(this.chain[0]!);
    if (root === undefined) throw new Error('Select an existing path chain.');
    const name = data.bones[root]!.name;
    if (this.existingPathId === null) {
      data.bones.push({
        id: this.ownerId,
        name: `${name} path`,
        parentId: null,
        length: 0,
        setupPose: {
          ...identity(),
          x: sk.pose.worldMatrices[root * 6 + 4]!,
          y: sk.pose.worldMatrices[root * 6 + 5]!,
        },
      });
      (data.paths ??= []).push({
        id: this.pathId,
        name: `${name} motion path`,
        boneId: this.ownerId,
        closed: false,
        segments: [[0, 0, 60, 60, 140, 60, 200, 0]],
      });
    }
    data.bones.push({
      id: this.driverId,
      name: `${name} path progress`,
      parentId: null,
      length: 0,
      setupPose: identity(),
    });
    (data.pathConstraints ??= []).push({
      id: this.constraintId,
      bones: [...this.chain],
      pathId: this.existingPathId ?? this.pathId,
      progress: 0,
      driverId: this.driverId,
      spacing: 30,
      mixTranslation: 1,
      mixRotation: 1,
      rotationOffset: 0,
      order: nextPrimaryConstraintOrder(data),
    });
  }
}
export class EditPathConstraintCommand extends AtomicConstraintCommand {
  readonly label = 'Edit path follow';
  private readonly patch: Partial<Omit<PathConstraintData, 'id' | 'bones' | 'order'>>;
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
    patch: Partial<Omit<PathConstraintData, 'id' | 'bones' | 'order'>>,
  ) {
    super(engine);
    this.patch = structuredClone(patch);
  }
  protected edit(data: SkeletonData): void {
    const c = data.pathConstraints?.find((c) => c.id === this.constraintId);
    if (!c) throw new Error('Path constraint no longer exists.');
    Object.assign(c, this.patch);
  }
}
export class RemovePathConstraintCommand extends AtomicConstraintCommand {
  readonly label = 'Delete path follow';
  constructor(
    engine: EditorEngine,
    readonly constraintId: string,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (!data.pathConstraints?.some((c) => c.id === this.constraintId))
      throw new Error('Path constraint no longer exists.');
    data.pathConstraints = data.pathConstraints.filter((c) => c.id !== this.constraintId);
  }
}
/** Endpoints update neighbours in the same transaction, keeping exact continuity/closure. */
export class SetPathPointCommand extends AtomicConstraintCommand {
  readonly label = 'Edit path point';
  constructor(
    engine: EditorEngine,
    readonly pathId: string,
    readonly segment: number,
    readonly coordinate: number,
    readonly value: number,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    const p = data.paths?.find((p) => p.id === this.pathId),
      s = p?.segments[this.segment];
    if (!p || !s || !Number.isInteger(this.coordinate) || this.coordinate < 0 || this.coordinate > 7)
      throw new Error('Path point no longer exists.');
    s[this.coordinate] = this.value;
    if (this.coordinate < 2) {
      const prev = p.segments[this.segment - 1] ?? (p.closed ? p.segments[p.segments.length - 1] : undefined);
      if (prev) prev[6 + this.coordinate] = this.value;
    }
    if (this.coordinate > 5) {
      const next = p.segments[this.segment + 1] ?? (p.closed ? p.segments[0] : undefined);
      if (next) next[this.coordinate - 6] = this.value;
    }
  }
}
export class EditPathShapeCommand extends AtomicConstraintCommand {
  readonly label = 'Edit path shape';
  constructor(
    engine: EditorEngine,
    readonly pathId: string,
    readonly action: 'extend' | 'removeLast' | 'close' | 'open',
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    const p = data.paths?.find((p) => p.id === this.pathId);
    if (!p) throw new Error('Path no longer exists.');
    if (this.action === 'open') {
      p.closed = false;
      return;
    }
    if (p.closed) throw new Error('Open the path before changing its segment count.');
    if (this.action === 'removeLast') {
      if (p.segments.length === 1) throw new Error('Keep at least one cubic segment.');
      p.segments.pop();
      return;
    }
    const last = p.segments[p.segments.length - 1]!,
      x = last[6],
      y = last[7];
    if (this.action === 'close') {
      const start = p.segments[0]!;
      p.segments.push([
        x,
        y,
        x + (start[0] - x) / 3,
        y + (start[1] - y) / 3,
        x + (2 * (start[0] - x)) / 3,
        y + (2 * (start[1] - y)) / 3,
        start[0],
        start[1],
      ]);
      p.closed = true;
    } else {
      let dx = x - last[4],
        dy = y - last[5];
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        dx = (dx / length) * 100;
        dy = (dy / length) * 100;
      } else dx = 100;
      p.segments.push([x, y, x + dx / 3, y + dy / 3, x + (2 * dx) / 3, y + (2 * dy) / 3, x + dx, y + dy]);
    }
  }
}
export class RemovePathCommand extends AtomicConstraintCommand {
  readonly label = 'Delete path';
  constructor(
    engine: EditorEngine,
    readonly pathId: string,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (!data.paths?.some((p) => p.id === this.pathId)) throw new Error('Path no longer exists.');
    data.paths = data.paths.filter((p) => p.id !== this.pathId);
    if (data.pathConstraints)
      data.pathConstraints = data.pathConstraints.filter((c) => c.pathId !== this.pathId);
  }
}
