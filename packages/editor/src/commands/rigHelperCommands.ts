import { uuid, type BoneData, type SkeletonData, type SceneMatrix, type Transform } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';
import { decomposeAffine, worldToLocalAffine } from '../math/matrix';
import { createMarker } from './markerCommands';
import { applyRigSnapshot, captureRig, prepareRigEdit, type RigSnapshot } from './rigEdits';

function localFromWorld(world: ArrayLike<number>, parent?: ArrayLike<number>): Transform {
  const local = new Float64Array(Array.from(world));
  if (parent) worldToLocalAffine(parent, world, local);
  return decomposeAffine(local[0]!, local[1]!, local[2]!, local[3]!, local[4]!, local[5]!);
}
function uniqueName(names: Set<string>, base: string): string {
  let name = base,
    suffix = 2;
  while (names.has(name)) name = base + suffix++;
  names.add(name);
  return name;
}

/** Snapshots keep generated IDs stable and every helper insertion in one undo step. */
abstract class SetupHelper implements Command {
  abstract readonly label: string;
  readonly rootBoneId = uuid();
  protected before: RigSnapshot | null = null;
  protected after: RigSnapshot | null = null;
  constructor(protected engine: EditorEngine) {}
  protected abstract edit(data: SkeletonData): void;
  do(): void {
    if (this.after) {
      applyRigSnapshot(this.engine, this.after);
      return;
    }
    if (this.engine.mode !== 'setup') throw new Error('Switch to Setup to use rig helpers.');
    const before = captureRig(this.engine);
    const after = prepareRigEdit(this.engine, (data) => this.edit(data));
    applyRigSnapshot(this.engine, after);
    this.before = before;
    this.after = after;
  }
  undo(): void {
    if (this.before) applyRigSnapshot(this.engine, this.before);
  }
}

export interface HumanGuideOptions {
  height: number;
  x: number;
  y: number;
  name: string;
}
/** Adds a y-down, adjustable fifteen-bone guide; existing artwork and tracks are untouched. */
export class AddHumanGuideCommand extends SetupHelper {
  readonly label = 'Add Human Guide';
  private readonly options: HumanGuideOptions;
  constructor(engine: EditorEngine, options: HumanGuideOptions) {
    super(engine);
    this.options = { ...options };
  }
  protected edit(data: SkeletonData): void {
    const { height, x, y, name } = this.options;
    if (![height, x, y].every(Number.isFinite) || height < 1 || height > 10000 || !name.trim()) {
      throw new Error('Human guide needs a name, finite position and height from 1 to 10000.');
    }
    const names = new Set(data.bones.map((bone) => bone.name));
    let prefix = name.trim(),
      suffix = 2;
    while ([...names].some((existing) => existing === prefix || existing.startsWith(prefix + '.')))
      prefix = name.trim() + suffix++;
    const worlds = new Map<string, SceneMatrix>(),
      ids = new Map<string, string>();
    const add = (part: string, parent: string | null, ax: number, ay: number, bx: number, by: number) => {
      const angle = Math.atan2(by - ay, bx - ax);
      const world: SceneMatrix = [
        Math.cos(angle),
        Math.sin(angle),
        -Math.sin(angle),
        Math.cos(angle),
        x + ax * height,
        y + ay * height,
      ];
      const id = parent === null ? this.rootBoneId : uuid();
      const bone: BoneData = {
        id,
        name: uniqueName(names, prefix + '.' + part),
        parentId: parent ? ids.get(parent)! : null,
        length: Math.hypot(bx - ax, by - ay) * height,
        setupPose: localFromWorld(world, parent ? worlds.get(parent) : undefined),
      };
      data.bones.push(bone);
      worlds.set(part, world);
      ids.set(part, id);
      return bone;
    };
    add('pelvis', null, 0, 0, 0, -0.08);
    add('spine', 'pelvis', 0, -0.08, 0, -0.3);
    add('head', 'spine', 0, -0.3, 0, -0.5);
    for (const [side, sign] of [
      ['L', -1],
      ['R', 1],
    ] as const) {
      add('upperArm.' + side, 'spine', sign * 0.12, -0.28, sign * 0.23, -0.1);
      add('forearm.' + side, 'upperArm.' + side, sign * 0.23, -0.1, sign * 0.28, 0.07);
      const hand = add('hand.' + side, 'forearm.' + side, sign * 0.28, 0.07, sign * 0.31, 0.12);
      add('thigh.' + side, 'pelvis', sign * 0.07, 0, sign * 0.08, 0.25);
      add('shin.' + side, 'thigh.' + side, sign * 0.08, 0.25, sign * 0.08, 0.47);
      const foot = add('foot.' + side, 'shin.' + side, sign * 0.08, 0.47, sign * 0.16, 0.5);
      for (const bone of [hand, foot]) {
        const marker = createMarker(bone.id);
        marker.name = bone.name + '.socket';
        marker.transform.x = bone.length;
        (data.markers ??= []).push(marker);
      }
    }
  }
}

/** Duplicates setup bones and their markers, reflected about rig-space X=axisX. */
export class MirrorBonesCommand extends SetupHelper {
  readonly label = 'Mirror Bones';
  constructor(
    engine: EditorEngine,
    private boneId: string,
    private axisX: number,
  ) {
    super(engine);
  }
  protected edit(data: SkeletonData): void {
    if (!Number.isFinite(this.axisX)) throw new Error('Mirror axis must be finite.');
    if (!data.bones.some((bone) => bone.id === this.boneId)) throw new Error('Select a bone to mirror.');
    const selected = new Set([this.boneId]);
    for (const bone of data.bones) if (bone.parentId && selected.has(bone.parentId)) selected.add(bone.id);
    const source = data.bones.filter((bone) => selected.has(bone.id));
    const worlds = this.engine.solveSetupWorlds(),
      indices = this.engine.skeleton.boneIndexMap;
    const originalWorld = (id: string) =>
      Array.from(worlds.slice(indices.get(id)! * 6, indices.get(id)! * 6 + 6));
    const reflected = new Map(
      source.map((bone) => {
        const w = originalWorld(bone.id);
        return [bone.id, [-w[0]!, w[1]!, -w[2]!, w[3]!, 2 * this.axisX - w[4]!, w[5]!] as SceneMatrix];
      }),
    );
    const ids = new Map(source.map((bone) => [bone.id, bone.id === this.boneId ? this.rootBoneId : uuid()]));
    const names = new Set(data.bones.map((bone) => bone.name));
    for (const bone of source) {
      const parent = bone.parentId
        ? (reflected.get(bone.parentId) ?? originalWorld(bone.parentId))
        : undefined;
      data.bones.push({
        ...structuredClone(bone),
        id: ids.get(bone.id)!,
        name: uniqueName(names, bone.name + '.mirror'),
        parentId: bone.parentId ? (ids.get(bone.parentId) ?? bone.parentId) : null,
        setupPose: localFromWorld(reflected.get(bone.id)!, parent),
      });
    }
    const markerNames = new Set((data.markers ?? []).map((marker) => marker.name));
    for (const marker of [...(data.markers ?? [])]) {
      const boneId = ids.get(marker.boneId);
      if (boneId)
        data.markers!.push({
          ...structuredClone(marker),
          id: uuid(),
          name: uniqueName(markerNames, marker.name + '.mirror'),
          boneId,
        });
    }
  }
}
