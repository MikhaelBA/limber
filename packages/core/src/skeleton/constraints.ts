import type {
  IKConstraintData,
  SkeletonData,
  PathConstraintData,
  TransformConstraintData,
} from '../types/data';
import type { Skeleton } from './Skeleton';
import { solveIK } from './IKSolver';
import { solveFK } from './FKSolver';
import { solveTransformConstraint } from './TransformSolver';
import { composeAffine } from '../math/affine';
import { validatePaths } from './validatePaths';
import { solvePathConstraint } from './PathSolver';

export type ConstraintEntry =
  | { kind: 'ik'; data: IKConstraintData }
  | { kind: 'transform'; data: TransformConstraintData }
  | { kind: 'path'; data: PathConstraintData };
export function orderedConstraints(data: SkeletonData): ConstraintEntry[] {
  if (data.transformConstraints !== undefined && !Array.isArray(data.transformConstraints))
    throw new Error('Transform constraints must be an array.');
  if (data.pathConstraints !== undefined && !Array.isArray(data.pathConstraints))
    throw new Error('Path constraints must be an array.');
  const list: ConstraintEntry[] = data.ikConstraints.map((c) => ({ kind: 'ik', data: c }));
  for (const c of data.transformConstraints ?? []) list.push({ kind: 'transform', data: c });
  for (const c of data.pathConstraints ?? []) list.push({ kind: 'path', data: c });
  return list.sort((a, b) => a.data.order - b.data.order);
}

/** Editing/load-time validation. Bone hierarchy must already be validated/sorted. */
export function validateConstraints(data: SkeletonData): void {
  validatePaths(data);
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
  const paths = new Map((data.paths ?? []).map((p) => [p.id, p]));
  for (const c of data.pathConstraints ?? []) {
    if (typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id))
      throw new Error('Path constraint IDs must be unique across all constraints.');
    ids.add(c.id);
    if (!Number.isSafeInteger(c.order) || c.order < 0 || orders.has(c.order))
      throw new Error(`Path constraint "${c.id}" needs a unique nonnegative integer order.`);
    orders.add(c.order);
    if (
      !Array.isArray(c.bones) ||
      c.bones.length < 1 ||
      c.bones.length > 128 ||
      c.bones.some((id) => !bones.has(id))
    )
      throw new Error(`Path constraint "${c.id}" needs 1–128 existing chain bones.`);
    for (let i = 1; i < c.bones.length; i++)
      if (bones.get(c.bones[i]!)!.parentId !== c.bones[i - 1])
        throw new Error(`Path constraint "${c.id}" needs a direct parent/child chain.`);
    const path = paths.get(c.pathId);
    if (!path || affected(c.bones[0]!, path.boneId))
      throw new Error(`Path constraint "${c.id}" needs a path outside its controlled subtree.`);
    if (c.driverId !== null && (!bones.has(c.driverId) || affected(c.bones[0]!, c.driverId)))
      throw new Error(`Path constraint "${c.id}" needs an independent progress driver.`);
    for (const key of ['progress', 'spacing', 'rotationOffset'] as const)
      if (!Number.isFinite(c[key]) || !Number.isFinite(Math.fround(c[key])))
        throw new Error(`Path constraint "${c.id}" has invalid ${key}.`);
    if (c.spacing < 0) throw new Error(`Path constraint "${c.id}" spacing must be nonnegative.`);
    for (const key of ['mixTranslation', 'mixRotation'] as const)
      if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1)
        throw new Error(`Path constraint "${c.id}" ${key} must be between 0 and 1.`);
  }
  const constraints = orderedConstraints(data);
  const rootOf = (entry: ConstraintEntry): string =>
    entry.kind === 'transform' ? entry.data.boneId : entry.data.bones[0]!;
  const writesLocal = (entry: ConstraintEntry, id: string): boolean =>
    entry.kind === 'transform' ? entry.data.boneId === id : entry.data.bones.includes(id);
  const edges: number[][] = constraints.map(() => []),
    indegree = constraints.map(() => 0);
  for (let writer = 0; writer < constraints.length; writer++) {
    const writing = constraints[writer]!,
      root = rootOf(writing);
    for (let reader = 0; reader < constraints.length; reader++) {
      if (writer === reader) continue;
      const reading = constraints[reader]!,
        parent = bones.get(rootOf(reading))!.parentId;
      // Rotation changes descendants' positions, but leaves the writer root's
      // own origin intact. Parent reads also need its changing linear basis.
      let depends: boolean;
      if (reading.kind === 'path') {
        const c = reading.data,
          owner = paths.get(c.pathId)!.boneId;
        depends =
          affected(root, owner) ||
          (parent !== null && affected(root, parent)) ||
          (c.driverId !== null && writesLocal(writing, c.driverId));
      } else if (reading.kind === 'transform' && reading.data.space === 'local') {
        depends = writesLocal(writing, reading.data.targetId);
      } else if (reading.kind === 'transform') {
        const c = reading.data;
        depends = affected(root, c.targetId) || (parent !== null && affected(root, parent));
      } else {
        const c = reading.data,
          pole = c.poleVectorId;
        depends =
          ((writing.kind !== 'ik' || root !== c.targetId) && affected(root, c.targetId)) ||
          (pole !== null && (writing.kind !== 'ik' || root !== pole) && affected(root, pole)) ||
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
const fields = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const;
export function solveConstraints(skeleton: Skeleton): void {
  for (const entry of skeleton.constraintOrder) {
    const count = entry.kind === 'transform' ? 1 : entry.data.bones.length;
    for (let i = 0; i < count; i++) {
      const id = entry.kind === 'transform' ? entry.data.boneId : entry.data.bones[i]!;
      const local = skeleton.pose.bones[skeleton.boneIndexMap.get(id)!]!.local;
      for (let k = 0; k < fields.length; k++) skeleton.constraintLocalBackup[i * 7 + k] = local[fields[k]!];
    }
    skeleton.constraintWorldBackup.set(skeleton.pose.worldMatrices);
    if (entry.kind === 'ik') solveIK(skeleton.data, skeleton.boneIndexMap, skeleton.pose, entry.data);
    else if (entry.kind === 'transform')
      solveTransformConstraint(skeleton.data, skeleton.boneIndexMap, skeleton.pose, entry.data);
    else solvePathConstraint(skeleton, entry.data);
    if (!skeleton.pose.worldMatrices.every(Number.isFinite)) {
      for (let i = 0; i < count; i++) {
        const id = entry.kind === 'transform' ? entry.data.boneId : entry.data.bones[i]!;
        const local = skeleton.pose.bones[skeleton.boneIndexMap.get(id)!]!.local;
        for (let k = 0; k < fields.length; k++)
          local[fields[k]!] = skeleton.constraintLocalBackup[i * 7 + k]!;
      }
      skeleton.pose.worldMatrices.set(skeleton.constraintWorldBackup);
    }
  }
}
