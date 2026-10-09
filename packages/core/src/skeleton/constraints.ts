import type { IKConstraintData, SkeletonData, Transform, TransformConstraintData } from '../types/data';
import type { Skeleton } from './Skeleton';
import { solveIK } from './IKSolver';
import { solveFK } from './FKSolver';
import { solveTransformConstraint } from './TransformSolver';
import { composeAffine } from '../math/affine';

export type ConstraintEntry =
  { kind: 'ik'; data: IKConstraintData } | { kind: 'transform'; data: TransformConstraintData };
export function orderedConstraints(data: SkeletonData): ConstraintEntry[] {
  if (data.transformConstraints !== undefined && !Array.isArray(data.transformConstraints))
    throw new Error('Transform constraints must be an array.');
  const list: ConstraintEntry[] = data.ikConstraints.map((c) => ({ kind: 'ik', data: c }));
  for (const c of data.transformConstraints ?? []) list.push({ kind: 'transform', data: c });
  return list.sort((a, b) => a.data.order - b.data.order);
}

/** Editing/load-time validation. Bone hierarchy must already be validated/sorted. */
export function validateConstraints(data: SkeletonData): void {
  const bones = new Map(data.bones.map((bone) => [bone.id, bone]));
  const children = new Map<string, string[]>();
  for (const bone of data.bones) {
    if (!Number.isFinite(bone.length) || bone.length < 0 || !Number.isFinite(Math.fround(bone.length)))
      throw new Error(`Bone "${bone.name}" needs a finite nonnegative length.`);
    for (const field of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const) {
      const value = bone.setupPose[field];
      if (typeof value !== 'number' || !Number.isFinite(Math.fround(value)))
        throw new Error(`Bone "${bone.name}" has an invalid setup ${field}.`);
    }
    if (bone.parentId !== null) {
      const list = children.get(bone.parentId) ?? [];
      list.push(bone.id);
      children.set(bone.parentId, list);
    }
  }
  // Iterative DFS intervals make subtree membership O(1), without deep recursion.
  const start = new Map<string, number>(),
    end = new Map<string, number>();
  let clock = 0;
  const stack: { id: string; exit: boolean }[] = data.bones
    .filter((b) => b.parentId === null)
    .map((b) => ({ id: b.id, exit: false }));
  while (stack.length) {
    const item = stack.pop()!;
    if (item.exit) {
      end.set(item.id, clock);
      continue;
    }
    start.set(item.id, clock++);
    stack.push({ id: item.id, exit: true });
    for (const id of children.get(item.id) ?? []) stack.push({ id, exit: false });
  }
  if (start.size !== data.bones.length)
    throw new Error('Constraint validation requires a valid bone hierarchy.');
  const setup = {
    bones: data.bones.map((bone) => ({ local: bone.setupPose })),
    worldMatrices: new Float32Array(data.bones.length * 6),
  };
  solveFK(data, new Map(data.bones.map((bone, index) => [bone.id, index])), setup);
  if (!setup.worldMatrices.every(Number.isFinite))
    throw new Error('Bone setup world transforms exceed finite pose precision.');
  const affected = (root: string, id: string): boolean =>
    start.get(id)! >= start.get(root)! && start.get(id)! < end.get(root)!;
  const ids = new Set<string>(),
    orders = new Set<number>();
  for (const c of data.ikConstraints) {
    if (typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id))
      throw new Error('IK constraint IDs must be nonempty and unique.');
    ids.add(c.id);
    if (!Number.isSafeInteger(c.order) || c.order < 0 || orders.has(c.order))
      throw new Error(`IK constraint "${c.id}" needs a unique nonnegative integer order.`);
    orders.add(c.order);
    if (!Array.isArray(c.bones) || c.bones.length < 1 || c.bones.length > 2)
      throw new Error(`IK constraint "${c.id}" must control 1 or 2 bones.`);
    for (const id of [...c.bones, c.targetId])
      if (!bones.has(id)) throw new Error(`IK constraint "${c.id}" references unknown boneId "${id}".`);
    if (c.bones.length === 2 && bones.get(c.bones[1]!)!.parentId !== c.bones[0])
      throw new Error(`IK constraint "${c.id}": the second bone must be a direct child of the first.`);
    if (affected(c.bones[0]!, c.targetId))
      throw new Error(
        `IK constraint "${c.id}" target cannot be inside its controlled subtree (feedback cycle).`,
      );
    if (!Number.isFinite(c.mix) || c.mix < 0 || c.mix > 1)
      throw new Error(`IK constraint "${c.id}" strength must be finite and between 0 and 1.`);
    if (c.bendDirection !== 1 && c.bendDirection !== -1)
      throw new Error(`IK constraint "${c.id}" bend direction must be 1 or -1.`);
    if (c.poleVectorId !== null && !bones.has(c.poleVectorId))
      throw new Error(`IK constraint "${c.id}" references unknown poleVectorId "${c.poleVectorId}".`);
    if (c.poleVectorId !== null && affected(c.bones[0]!, c.poleVectorId))
      throw new Error(
        `IK constraint "${c.id}" pole cannot be inside its controlled subtree (feedback cycle).`,
      );
    if (!Number.isFinite(c.softness) || c.softness < 0 || !Number.isFinite(Math.fround(c.softness)))
      throw new Error(`IK constraint "${c.id}" softness must be finite and nonnegative.`);
    if (c.bones.length === 1 && (c.poleVectorId !== null || c.softness !== 0))
      throw new Error(`IK constraint "${c.id}" pole/softness require a two-bone chain.`);
  }
  const offsetMatrix = new Float64Array(6);
  for (const c of data.transformConstraints ?? []) {
    if (typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id))
      throw new Error('Transform constraint IDs must be nonempty and unique across all constraints.');
    ids.add(c.id);
    if (!Number.isSafeInteger(c.order) || c.order < 0 || orders.has(c.order))
      throw new Error(
        `Transform constraint "${c.id}" needs a unique nonnegative integer order across all constraints.`,
      );
    orders.add(c.order);
    if (!bones.has(c.boneId) || !bones.has(c.targetId))
      throw new Error(`Transform constraint "${c.id}" references an unknown bone.`);
    if (affected(c.boneId, c.targetId))
      throw new Error(
        `Transform constraint "${c.id}" target cannot be inside its controlled subtree (feedback cycle).`,
      );
    if (c.space !== 'world' && c.space !== 'local')
      throw new Error(`Transform constraint "${c.id}" needs world or local space.`);
    for (const key of ['mixTranslation', 'mixRotation', 'mixScale', 'mixShear'] as const)
      if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1)
        throw new Error(`Transform constraint "${c.id}" ${key} must be finite and between 0 and 1.`);
    for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const)
      if (typeof c.offset?.[key] !== 'number' || !Number.isFinite(Math.fround(c.offset[key])))
        throw new Error(`Transform constraint "${c.id}" has invalid offset ${key}.`);
    composeAffine(c.offset, offsetMatrix);
    if (!offsetMatrix.every((value) => Number.isFinite(Math.fround(value))))
      throw new Error(`Transform constraint "${c.id}" offset exceeds finite pose precision.`);
  }
  const constraints = orderedConstraints(data);
  const rootOf = (entry: ConstraintEntry): string =>
    entry.kind === 'ik' ? entry.data.bones[0]! : entry.data.boneId;
  const edges: number[][] = constraints.map(() => []),
    indegree = constraints.map(() => 0);
  for (let writer = 0; writer < constraints.length; writer++) {
    const writing = constraints[writer]!,
      root = rootOf(writing);
    for (let reader = 0; reader < constraints.length; reader++) {
      if (writer === reader) continue;
      const reading = constraints[reader]!,
        c = reading.data,
        parent = bones.get(rootOf(reading))!.parentId;
      // Rotation changes descendants' positions, but leaves the writer root's
      // own origin intact. Parent reads also need its changing linear basis.
      let depends: boolean;
      if (reading.kind === 'transform' && reading.data.space === 'local') {
        depends = writing.kind === 'ik' ? writing.data.bones.includes(c.targetId) : root === c.targetId;
      } else if (reading.kind === 'transform') {
        depends = affected(root, c.targetId) || (parent !== null && affected(root, parent));
      } else {
        const pole = reading.data.poleVectorId;
        depends =
          ((writing.kind === 'transform' || root !== c.targetId) && affected(root, c.targetId)) ||
          (pole !== null && (writing.kind === 'transform' || root !== pole) && affected(root, pole)) ||
          (parent !== null && affected(root, parent));
      }
      if (depends) {
        edges[writer]!.push(reader);
        indegree[reader]!++;
      }
    }
  }
  const ready = indegree.flatMap((n, i) => (n === 0 ? [i] : []));
  for (let i = 0; i < ready.length; i++)
    for (const reader of edges[ready[i]!]!) if (--indegree[reader]! === 0) ready.push(reader);
  if (ready.length !== constraints.length)
    throw new Error('Constraint dependency cycle: use independent targets and chain parents.');
  for (let writer = 0; writer < constraints.length; writer++)
    for (const reader of edges[writer]!)
      if (constraints[writer]!.data.order >= constraints[reader]!.data.order)
        throw new Error(
          `Constraint "${constraints[reader]!.data.id}" must run after "${constraints[writer]!.data.id}" (target/pole/parent dependency).`,
        );
}

/** Shared preview/runtime pipeline stage: FK must be current on entry. No frame allocations. */
const firstBefore: Transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
const secondBefore: Transform = { ...firstBefore };
function copyTransform(to: Transform, from: Transform): void {
  to.x = from.x;
  to.y = from.y;
  to.rotation = from.rotation;
  to.scaleX = from.scaleX;
  to.scaleY = from.scaleY;
  to.shearX = from.shearX;
  to.shearY = from.shearY;
}
export function solveConstraints(skeleton: Skeleton): void {
  for (const entry of skeleton.constraintOrder) {
    const firstId = entry.kind === 'ik' ? entry.data.bones[0]! : entry.data.boneId;
    const secondId = entry.kind === 'ik' ? entry.data.bones[1] : undefined;
    const first = skeleton.pose.bones[skeleton.boneIndexMap.get(firstId)!]!.local;
    const second =
      secondId === undefined ? undefined : skeleton.pose.bones[skeleton.boneIndexMap.get(secondId)!]!.local;
    copyTransform(firstBefore, first);
    if (second) copyTransform(secondBefore, second);
    skeleton.constraintWorldBackup.set(skeleton.pose.worldMatrices);
    if (entry.kind === 'ik') solveIK(skeleton.data, skeleton.boneIndexMap, skeleton.pose, entry.data);
    else solveTransformConstraint(skeleton.data, skeleton.boneIndexMap, skeleton.pose, entry.data);
    if (!skeleton.pose.worldMatrices.every(Number.isFinite)) {
      copyTransform(first, firstBefore);
      if (second) copyTransform(second, secondBefore);
      skeleton.pose.worldMatrices.set(skeleton.constraintWorldBackup);
    }
  }
}
