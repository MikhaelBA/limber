import { describe, expect, it } from 'vitest';
import {
  Skeleton,
  PathSampler,
  solveFK,
  solveConstraints,
  projectFromLegacy,
  serializeProject,
  deserializeProject,
  PROJECT_SCHEMA_VERSION,
  type SkeletonData,
  type PathConstraintData,
  type PathData,
} from '../src/index';
import { makeBone, makeSkeletonData } from './helpers';
import { RuntimePlayer } from '../../runtime/src/player';
import { readFileSync } from 'node:fs';
const identity = [1, 0, 0, 1, 0, 0];
const path = (patch: Partial<PathData> = {}): PathData => ({
  id: 'path',
  name: 'Motion',
  boneId: 'owner',
  closed: false,
  segments: [[0, 0, 100 / 3, 0, 200 / 3, 0, 100, 0]],
  ...patch,
});
const constraint = (patch: Partial<PathConstraintData> = {}): PathConstraintData => ({
  id: 'pc',
  bones: ['bone', 'child'],
  pathId: 'path',
  progress: 0.2,
  driverId: null,
  spacing: 25,
  mixTranslation: 1,
  mixRotation: 1,
  rotationOffset: 0,
  order: 0,
  ...patch,
});
function rig(): SkeletonData {
  const d = makeSkeletonData([
    makeBone('owner', null),
    makeBone('parent', null, { x: 20, y: 10, rotation: 0.7, scaleX: -1.7, scaleY: 0.8, shearX: 0.2 }),
    makeBone('bone', 'parent', { x: 3, y: 5, rotation: -0.4, scaleX: -1.2, shearX: 0.3, shearY: 0.4 }),
    makeBone('child', 'bone', { x: 20, y: 2, rotation: 0.3 }),
    makeBone('driver', null),
  ]);
  d.paths = [path()];
  d.pathConstraints = [constraint()];
  return d;
}
function run(d: SkeletonData): Skeleton {
  const s = new Skeleton(d);
  solveFK(s.data, s.boneIndexMap, s.pose);
  solveConstraints(s);
  return s;
}
const world = (s: Skeleton, id: string) =>
  s.pose.worldMatrices.slice(s.boneIndexMap.get(id)! * 6, s.boneIndexMap.get(id)! * 6 + 6);
describe('deterministic cubic path sampling', () => {
  it('samples constant world spacing through nonuniform/reflected/sheared metrics and ignores translation for length', () => {
    const sampler = new PathSampler(path()),
      out = { x: 0, y: 0, tangentX: 0, tangentY: 0 },
      m = [-2, 1, 0.4, 3, 10, 20];
    expect(sampler.sample(Math.sqrt(5) * 25, m, 0, out)).toBe(true);
    expect(out.x).toBeCloseTo(-40, 8);
    expect(out.y).toBeCloseTo(45, 8);
    expect(sampler.length).toBeCloseTo(Math.sqrt(5) * 100, 8);
    const lengths = sampler.lengths.slice();
    m[4] = 80;
    m[5] = -10;
    sampler.sample(0, m, 0, out);
    expect(sampler.lengths).toEqual(lengths);
    m[0] = 1;
    m[1] = 0;
    sampler.updateMetric(m, 0);
    expect(sampler.length).toBeCloseTo(100, 8);
  });
  it('approximates curved arc length against dense independent integration and returns exact cubic coordinates', () => {
    const p = path({ segments: [[0, 0, 0, 100, 100, 100, 100, 0]] }),
      s = new PathSampler(p),
      out = { x: 0, y: 0, tangentX: 0, tangentY: 0 };
    s.sample(0, identity, 0, out);
    let dense = 0,
      px = 0,
      py = 0;
    for (let n = 1; n <= 20000; n++) {
      const t = n / 20000,
        x = 300 * t * t - 200 * t * t * t,
        y = 300 * t - 300 * t * t;
      dense += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    expect(Math.abs(s.length - dense)).toBeLessThan(0.006);
    s.sample(s.length / 2, identity, 0, out);
    expect(out.x).toBeCloseTo(50, 8);
    expect(out.y).toBeCloseTo(75, 8);
    expect(out.tangentY).toBeCloseTo(0, 8);
  });
  it('clamps open curves, wraps closed distances and handles repeated points/zero tangents', () => {
    const out = { x: 9, y: 9, tangentX: 9, tangentY: 9 },
      open = new PathSampler(path({ segments: [[0, 0, 0, 0, 100, 0, 100, 0]] }));
    open.sample(-999, identity, 0, out);
    expect(out.x).toBe(0);
    expect(out.tangentX).toBeGreaterThan(0);
    open.sample(999, identity, 0, out);
    expect(out.x).toBe(100);
    expect(out.tangentX).toBeGreaterThan(0);
    const loop = new PathSampler(path({ closed: true, segments: [[0, 0, 30, 30, 30, -30, 0, 0]] }));
    loop.updateMetric(identity, 0);
    loop.sample(loop.length * 0.25, identity, 0, out);
    const a = { ...out };
    loop.sample(-loop.length * 0.75, identity, 0, out);
    expect(out.x).toBeCloseTo(a.x, 8);
    expect(out.y).toBeCloseTo(a.y, 8);
    const zero = new PathSampler(path({ segments: [[1, 2, 1, 2, 1, 2, 1, 2]] })),
      before = { ...out };
    expect(zero.sample(0, identity, 0, out)).toBe(false);
    expect(out).toEqual(before);
    expect(open.sample(50, [1, 0, 0, 1, Infinity, 0], 0, out)).toBe(false);
    expect(out).toEqual(before);
  });
  it('crosses joined cubic segments without a parameter jump', () => {
    const s = new PathSampler(
        path({
          segments: [
            [0, 0, 10, 0, 20, 0, 30, 0],
            [30, 0, 30, 10, 30, 20, 30, 30],
          ],
        }),
      ),
      out = { x: 0, y: 0, tangentX: 0, tangentY: 0 };
    s.sample(45, identity, 0, out);
    expect(out.x).toBeCloseTo(30, 8);
    expect(out.y).toBeCloseTo(15, 8);
    expect(s.length).toBeCloseTo(60, 8);
  });
});
describe('ordered path solver', () => {
  it('loads the real editor schema-8 fixture and samples its keyed progress in the runtime', () => {
    const project = deserializeProject(readFileSync('fixtures/bbbproj-v8-path-follow.json', 'utf8'));
    const node = project.artboards[0]!.nodes.find((n) => n.type === 'rig');
    if (!node || node.type !== 'rig') throw new Error('Expected path rig fixture.');
    const c = node.skeleton.pathConstraints![0]!;
    const player = new RuntimePlayer({
      skeleton: structuredClone(node.skeleton),
      animations: node.animations,
    });
    player.setAnimation('Travel');
    player.update(0.1);
    const s = run(structuredClone(node.skeleton));
    s.resetToSetupPose();
    s.pose.bones[s.boneIndexMap.get(c.driverId!)!]!.local.x = 70;
    solveFK(s.data, s.boneIndexMap, s.pose);
    solveConstraints(s);
    expect(world(s, 'tail')[4]).toBeCloseTo(260, 4);
    expect(world(s, 'tail')[5]).toBeCloseTo(100, 4);
    expect(player.getWorldTransforms()).toEqual(s.pose.worldMatrices);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
  it('matches independently transformed straight-path goldens across 100 seeded arbitrary affine hierarchies', () => {
    let state = 17391;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let n = 0; n < 100; n++) {
      const d = rig();
      for (const b of d.bones) {
        const t = b.setupPose;
        t.rotation = random() * 6 - 3;
        t.scaleX = (random() < 0.5 ? -1 : 1) * (0.5 + random() * 2);
        t.scaleY = (random() < 0.5 ? -1 : 1) * (0.5 + random() * 2);
        t.shearX = random() - 0.5;
        t.shearY = random() - 0.5;
      }
      const s = run(d),
        owner = world(s, 'owner'),
        norm = Math.hypot(owner[0]!, owner[1]!);
      for (const [id, distance] of [
        ['bone', 20 * norm],
        ['child', 20 * norm + 25],
      ] as const) {
        const wm = world(s, id),
          x = owner[4]! + (owner[0]! * distance) / norm,
          y = owner[5]! + (owner[1]! * distance) / norm;
        expect(Math.hypot(wm[4]! - x, wm[5]! - y)).toBeLessThan(0.0003);
        const cross = wm[0]! * owner[1]! - wm[1]! * owner[0]!;
        expect(Math.abs(cross)).toBeLessThan(0.0003);
        expect(wm[0]! * owner[0]! + wm[1]! * owner[1]!).toBeGreaterThan(0);
      }
    }
  });
  it('rolls back every chain local and preceding world matrix when tangent alignment would overflow a descendant', () => {
    const d = rig();
    d.bones.find((b) => b.id === 'parent')!.setupPose = {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1e38,
      scaleY: 1e30,
      shearX: 0,
      shearY: 0,
    };
    d.bones.find((b) => b.id === 'bone')!.setupPose = {
      x: 0,
      y: 0,
      rotation: Math.PI / 2,
      scaleX: 1000,
      scaleY: 0.001,
      shearX: 0,
      shearY: 0,
    };
    d.bones.find((b) => b.id === 'child')!.setupPose = {
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
    };
    const s = new Skeleton(d);
    solveFK(s.data, s.boneIndexMap, s.pose);
    const local = structuredClone(s.pose.bones),
      wm = s.pose.worldMatrices.slice();
    solveConstraints(s);
    expect(s.pose.bones).toEqual(local);
    expect(s.pose.worldMatrices).toEqual(wm);
  });
  it('places a chain at spaced origins and aims its signed/sheared +X through an affine parent without changing the basis fields', () => {
    const d = rig(),
      s = run(d);
    for (const [id, x] of [
      ['bone', 20],
      ['child', 45],
    ] as const) {
      const m = world(s, id);
      expect(m[4]).toBeCloseTo(x, 4);
      expect(m[5]).toBeCloseTo(0, 4);
      expect(m[0]).toBeGreaterThan(0);
      expect(m[1]).toBeCloseTo(0, 4);
    }
    for (const id of ['bone', 'child']) {
      const i = s.boneIndexMap.get(id)!;
      for (const f of ['scaleX', 'scaleY', 'shearX', 'shearY'] as const)
        expect(s.pose.bones[i]!.local[f]).toBe(s.data.bones[i]!.setupPose[f]);
    }
  });
  it('measures spacing in world units even when the owner is scaled or animated', () => {
    const d = rig();
    d.bones[0]!.setupPose.scaleX = 2;
    const s = run(d);
    expect(world(s, 'bone')[4]).toBeCloseTo(40, 4);
    expect(world(s, 'child')[4]).toBeCloseTo(65, 4);
    s.resetToSetupPose();
    s.pose.bones[s.boneIndexMap.get('owner')!]!.local.scaleX = 3;
    solveFK(s.data, s.boneIndexMap, s.pose);
    solveConstraints(s);
    expect(world(s, 'bone')[4]).toBeCloseTo(60, 4);
    expect(world(s, 'child')[4]).toBeCloseTo(85, 4);
  });
  it('separates strength controls, uses percentage-point drivers and preserves source across repeated samples', () => {
    const d = rig();
    d.pathConstraints = [
      constraint({ bones: ['bone'], driverId: 'driver', mixRotation: 0, mixTranslation: 0.5 }),
    ];
    d.bones.find((b) => b.id === 'driver')!.setupPose.x = 30;
    const source = structuredClone(d),
      s = new Skeleton(d);
    solveFK(s.data, s.boneIndexMap, s.pose);
    const before = world(s, 'bone');
    solveConstraints(s);
    expect(world(s, 'bone')[4]).toBeCloseTo((before[4]! + 50) / 2, 4);
    expect(world(s, 'bone')[5]).toBeCloseTo(before[5]! / 2, 4);
    expect(s.pose.bones[s.boneIndexMap.get('bone')!]!.local.rotation).toBe(-0.4);
    for (let i = 0; i < 50; i++) {
      s.resetToSetupPose();
      solveFK(s.data, s.boneIndexMap, s.pose);
      solveConstraints(s);
    }
    expect(s.data).toEqual(source);
  });
  it('holds zero mixes, collapsed owner curves and singular controlled parents deterministically', () => {
    for (const mode of ['zero', 'owner', 'parent']) {
      const d = rig();
      if (mode === 'zero') d.pathConstraints = [constraint({ mixTranslation: 0, mixRotation: 0 })];
      else {
        const b = d.bones.find((b) => b.id === mode)!;
        b.setupPose.scaleX = 0;
        b.setupPose.scaleY = 0;
      }
      const s = new Skeleton(d);
      solveFK(s.data, s.boneIndexMap, s.pose);
      const before = structuredClone(s.pose.bones);
      solveConstraints(s);
      expect(s.pose.bones).toEqual(before);
      expect(s.pose.worldMatrices.every(Number.isFinite)).toBe(true);
    }
  });
  it('validates path continuity, closure, limits, chain, refs, mixes and global identity before publication', () => {
    const mutations: ((d: SkeletonData) => void)[] = [
      (d) => {
        d.paths![0]!.segments[0]!.pop();
      },
      (d) => {
        d.paths![0]!.closed = true;
      },
      (d) => {
        d.paths![0]!.segments.push([99, 0, 0, 0, 0, 0, 100, 0]);
      },
      (d) => {
        d.paths![0]!.boneId = 'missing';
      },
      (d) => {
        d.paths!.push(structuredClone(d.paths![0]!));
      },
      (d) => {
        d.pathConstraints![0]!.bones = ['bone', 'driver'];
      },
      (d) => {
        d.pathConstraints![0]!.driverId = 'child';
      },
      (d) => {
        d.pathConstraints![0]!.spacing = -1;
      },
      (d) => {
        d.pathConstraints![0]!.mixRotation = 2;
      },
      (d) => {
        d.pathConstraints![0]!.progress = NaN;
      },
      (d) => {
        d.paths![0]!.boneId = 'child';
      },
    ];
    for (const mutate of mutations) {
      const d = rig();
      mutate(d);
      expect(() => new Skeleton(d)).toThrow();
    }
    const s = run(rig()),
      data = structuredClone(s.data),
      pose = structuredClone(s.pose);
    const invalid = rig();
    invalid.pathConstraints![0]!.pathId = 'missing';
    expect(() => s.replaceData(invalid)).toThrow();
    expect(s.data).toEqual(data);
    expect(s.pose).toEqual(pose);
  });
  it('orders world owner writers and local driver writers before readers and rejects mixed feedback', () => {
    const d = rig();
    d.bones.push(makeBone('target', null, { x: 10 }));
    d.transformConstraints = [
      {
        id: 'follow',
        boneId: 'owner',
        targetId: 'target',
        space: 'world',
        offset: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
        mixTranslation: 1,
        mixRotation: 0,
        mixScale: 0,
        mixShear: 0,
        order: 0,
      },
    ];
    d.pathConstraints![0]!.order = 1;
    const s = run(d);
    expect(world(s, 'bone')[4]).toBeCloseTo(30, 4);
    d.transformConstraints[0]!.order = 2;
    expect(() => new Skeleton(structuredClone(d))).toThrow(/must run after/);
    d.transformConstraints[0]!.order = 0;
    d.transformConstraints[0]!.targetId = 'bone';
    expect(() => new Skeleton(structuredClone(d))).toThrow(/cycle/);
    const driverRig = rig();
    driverRig.pathConstraints![0]!.driverId = 'driver';
    driverRig.pathConstraints![0]!.order = 1;
    driverRig.transformConstraints = [
      { ...d.transformConstraints[0]!, boneId: 'driver', targetId: 'owner', space: 'local' },
    ];
    expect(() => new Skeleton(driverRig)).not.toThrow();
    driverRig.transformConstraints[0]!.order = 2;
    expect(() => new Skeleton(driverRig)).toThrow(/must run after/);
  });
  it('round trips source schema 8 and evaluates animated driver identically in runtime', () => {
    const d = rig();
    d.pathConstraints![0]!.driverId = 'driver';
    const animation = {
      name: 'Travel',
      duration: 1,
      loop: false,
      timelines: [
        {
          kind: 'boneProperty' as const,
          boneId: 'driver',
          property: 'x' as const,
          keyframes: [
            { time: 0, value: 0, curve: { type: 'linear' as const } },
            { time: 1, value: 50, curve: { type: 'linear' as const } },
          ],
        },
      ],
    };
    const doc = { skeleton: d, animations: [animation], assetManifest: {} },
      project = projectFromLegacy(doc);
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    const player = new RuntimePlayer(doc);
    player.setAnimation('Travel', { loop: false });
    player.update(0.1);
    const s = run(structuredClone(d));
    s.resetToSetupPose();
    s.pose.bones[s.boneIndexMap.get('driver')!]!.local.x = 5;
    solveFK(s.data, s.boneIndexMap, s.pose);
    solveConstraints(s);
    expect(world(s, 'bone')[4]).toBeCloseTo(25, 4);
    expect(player.getWorldTransforms()).toEqual(s.pose.worldMatrices);
  });
});
