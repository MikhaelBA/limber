import type { SkeletonData } from '../types/data';
import type { Skeleton } from './Skeleton';
import { solveIK } from './IKSolver';
import { solveFK } from './FKSolver';

/** Editing/load-time validation. Bone hierarchy must already be validated/sorted. */
export function validateIKConstraints(data: SkeletonData): void {
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
    if (c.poleVectorId !== null || c.softness !== 0)
      throw new Error(`IK constraint "${c.id}": pole targets and nonzero softness are not supported yet.`);
  }
  const constraints = data.ikConstraints;
  const edges: number[][] = constraints.map(() => []),
    indegree = constraints.map(() => 0);
  for (let writer = 0; writer < constraints.length; writer++) {
    const root = constraints[writer]!.bones[0]!;
    for (let reader = 0; reader < constraints.length; reader++) {
      if (writer === reader) continue;
      const c = constraints[reader]!,
        parent = bones.get(c.bones[0]!)!.parentId;
      if (affected(root, c.targetId) || (parent !== null && affected(root, parent))) {
        edges[writer]!.push(reader);
        indegree[reader]!++;
      }
    }
  }
  const ready = indegree.flatMap((n, i) => (n === 0 ? [i] : []));
  for (let i = 0; i < ready.length; i++)
    for (const reader of edges[ready[i]!]!) if (--indegree[reader]! === 0) ready.push(reader);
  if (ready.length !== constraints.length)
    throw new Error('IK constraint dependency cycle: use independent targets and chain parents.');
  for (let writer = 0; writer < constraints.length; writer++)
    for (const reader of edges[writer]!)
      if (constraints[writer]!.order >= constraints[reader]!.order)
        throw new Error(
          `IK constraint "${constraints[reader]!.id}" must run after "${constraints[writer]!.id}" (target/parent dependency).`,
        );
}

/** Shared preview/runtime pipeline stage: FK must be current on entry. No frame allocations. */
export function solveConstraints(skeleton: Skeleton): void {
  if (skeleton.data.ikConstraints.length) solveIK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
}
