import { describe, it, expect } from 'vitest';
import {
  Skeleton,
  RigLogicPoseBuffer,
  resolveLogicScenePose,
  blendLogicScenePoses,
  blendLogicNumber,
  sceneTransform,
  type Artboard,
  type SceneClip,
} from '../src/index';
import { makeBone, makeSkeletonData } from './helpers';
const rad = (degrees: number) => (degrees * Math.PI) / 180;
function rig() {
  const data = makeSkeletonData([
    makeBone('root', null, { x: 20, rotation: rad(170), scaleX: -2, shearX: 0.2 }),
    makeBone('child', 'root', { x: 10 }),
  ]);
  data.slots = [
    { id: 'slot', name: 'slot', boneId: 'root', defaultAttachmentId: 'mesh', color: 0xff0000ff },
    { id: 'other', name: 'other', boneId: 'child', defaultAttachmentId: null, color: 0xffffffff },
  ];
  data.attachments = [
    {
      id: 'mesh',
      name: 'mesh',
      type: 'mesh',
      textureId: '',
      meshVertices: [0, 0, 10, 0, 10, 10, 0, 10],
      meshTriangles: [0, 1, 2, 0, 2, 3],
      meshUVs: [0, 0, 1, 0, 1, 1, 0, 1],
      meshHull: [0, 1, 2, 3],
    },
  ];
  return new Skeleton(data);
}
function scene(): Artboard {
  return {
    id: 'board',
    name: 'board',
    width: 300,
    height: 300,
    nodes: [
      {
        id: 'a',
        name: 'a',
        type: 'group',
        parentId: null,
        transform: { ...sceneTransform(), x: 20, y: 10, rotation: rad(170), scaleX: -1, shearX: 0.2 },
        visible: true,
        opacity: 0.5,
      },
      {
        id: 'b',
        name: 'b',
        type: 'group',
        parentId: null,
        transform: sceneTransform(),
        visible: true,
        opacity: 0.8,
      },
    ],
  };
}
const clip: SceneClip = {
  id: 'clip',
  name: 'clip',
  duration: 1,
  loop: false,
  fps: 30,
  events: [],
  tracks: [
    {
      id: 'x',
      nodeId: 'a',
      property: 'x',
      keys: [{ id: 'x-key', time: 0, value: 100, curve: { type: 'stepped' } }],
    },
    {
      id: 'r',
      nodeId: 'a',
      property: 'rotation',
      keys: [{ id: 'r-key', time: 0, value: rad(-170), curve: { type: 'stepped' } }],
    },
    {
      id: 'o',
      nodeId: 'a',
      property: 'opacity',
      keys: [{ id: 'o-key', time: 0, value: 0.9, curve: { type: 'stepped' } }],
    },
  ],
};
describe('portable Logic pose blending', () => {
  it('resolves every scene channel against setup and matches independent shortest-arc/linear goldens', () => {
    const board = scene(),
      before = structuredClone(board),
      from = resolveLogicScenePose(board, null, 0),
      to = resolveLogicScenePose(board, clip, 0.5);
    const original = structuredClone({ from, to }),
      mixed = blendLogicScenePoses(from, to, 0.25);
    expect(mixed.transforms.a!.x).toBe(40);
    expect(mixed.transforms.a!.y).toBe(10);
    expect(mixed.transforms.a!.rotation).toBeCloseTo(rad(175), 12);
    expect(mixed.opacity.a).toBeCloseTo(0.6, 12);
    expect(mixed.transforms.a!.scaleX).toBe(-1);
    expect(mixed.transforms.a!.shearX).toBe(0.2);
    expect(mixed.transforms.b).toEqual(board.nodes[1]!.transform);
    expect(mixed.opacity.b).toBe(0.8);
    expect(blendLogicScenePoses(from, to, 0)).toEqual(from);
    expect(blendLogicScenePoses(from, to, 1)).toEqual(to);
    expect({ from, to }).toEqual(original);
    expect(board).toEqual(before);
  });
  it('restarts an interrupted blend from its actual current result and clears unkeyed destination channels', () => {
    const board = scene(),
      from = resolveLogicScenePose(board, null, 0),
      to = resolveLogicScenePose(board, clip, 1);
    const half = blendLogicScenePoses(from, to, 0.5);
    expect(half.transforms.a!.x).toBe(60);
    const destination = resolveLogicScenePose(
      board,
      { ...clip, tracks: [{ ...clip.tracks[0]!, keys: [{ ...clip.tracks[0]!.keys[0]!, value: 0 }] }] },
      0,
    );
    const interrupted = blendLogicScenePoses(half, destination, 0.25);
    expect(interrupted.transforms.a!.x).toBe(45);
    expect(interrupted.transforms.a!.y).toBe(10);
    expect(interrupted.opacity.a).toBeCloseTo(0.65, 12); // .7 frozen to setup .5
    expect(interrupted.transforms.a!.rotation).toBeCloseTo(rad(177.5), 12);
    to.transforms.a!.y = 99;
    expect(destination.transforms.a!.y).toBe(10);
  });
  it('blends bone/color/deform channels once while selecting destination attachment and draw order', () => {
    const skeleton = rig(),
      pose = skeleton.pose,
      snapshot = new RigLogicPoseBuffer(pose),
      source = structuredClone(skeleton.data);
    pose.bones[0]!.local.x = 100;
    pose.bones[0]!.local.rotation = rad(-170);
    pose.bones[0]!.local.scaleX = 2;
    pose.slots[0]!.color = 0x0000ffff;
    pose.slots[0]!.attachmentId = null;
    pose.slotOrder = [1, 0];
    const mesh = pose.attachments.get('mesh')!;
    mesh.deformed = true;
    mesh.deform.fill(8);
    snapshot.blendInto(pose, 0.5);
    expect(pose.bones[0]!.local.x).toBe(60);
    expect(pose.bones[0]!.local.rotation).toBeCloseTo(Math.PI, 12);
    expect(pose.bones[0]!.local.scaleX).toBe(0);
    expect(pose.bones[0]!.local.shearX).toBe(0.2);
    expect(pose.slots[0]!.color).toBe(0x800080ff);
    expect(pose.slots[0]!.attachmentId).toBeNull();
    expect(pose.slotOrder).toEqual([1, 0]);
    expect(mesh.deform).toEqual(new Float32Array(8).fill(4));
    expect(mesh.deformed).toBe(true);
    expect(skeleton.data).toEqual(source);
    // Capturing the current blend makes an interrupt interpolate 60 -> 0, not 20 -> 0.
    snapshot.capture(pose);
    pose.bones[0]!.local.x = 0;
    mesh.deform.fill(0);
    snapshot.blendInto(pose, 0.25);
    expect(pose.bones[0]!.local.x).toBe(45);
    expect(mesh.deform).toEqual(new Float32Array(8).fill(3));
  });
  it('keeps exact continuous endpoints and validates strengths/layout before writing any channel', () => {
    const skeleton = rig(),
      pose = skeleton.pose,
      snapshot = new RigLogicPoseBuffer(pose);
    pose.bones[0]!.local.x = -0;
    const before = structuredClone(pose);
    for (const mix of [NaN, Infinity, -0.1, 1.1]) {
      expect(() => snapshot.blendInto(pose, mix)).toThrow(/strength/);
      expect(pose).toEqual(before);
    }
    snapshot.blendInto(pose, 1);
    expect(Object.is(pose.bones[0]!.local.x, -0)).toBe(true);
    const from = resolveLogicScenePose(scene(), null, 0),
      to = structuredClone(from);
    delete to.transforms.b;
    expect(() => blendLogicScenePoses(from, to, 0.5)).toThrow(/identities/);
    const changed = structuredClone(pose);
    changed.attachments.get('mesh')!.deform = new Float32Array(2);
    const unchanged = structuredClone(changed);
    expect(() => snapshot.blendInto(changed, 0.5)).toThrow(/layout/);
    expect(changed).toEqual(unchanged);
    expect(blendLogicNumber(-1e308, 1e308, 0.5)).toBe(0);
    expect(Object.is(blendLogicNumber(-0, 10, 0), -0)).toBe(true);
  });
});
