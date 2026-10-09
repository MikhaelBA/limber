import { describe, expect, it } from 'vitest';
import {
  applyTimeline,
  deserializeDocument,
  deserializeProject,
  projectFromLegacy,
  serializeDocument,
  serializeProject,
  Skeleton,
  validateDeformTimelines,
  type Animation,
  type Curve,
  type DeformTimeline,
} from '../src';
import { makeBone, makeSkeletonData } from './helpers';

function fixture() {
  const skeleton = makeSkeletonData([makeBone('root', null)]);
  skeleton.attachments.push({
    id: 'mesh',
    name: 'mesh',
    type: 'mesh',
    textureId: '',
    meshVertices: [0, 0, 10, 0, 0, 10],
    meshUVs: [0, 0, 1, 0, 0, 1],
    meshTriangles: [0, 1, 2],
  });
  const timeline: DeformTimeline = {
    kind: 'deform',
    attachmentId: 'mesh',
    keyframes: [
      { time: 0, offsets: null, curve: { type: 'bezier', c1: 1 / 3, c2: 0, c3: 2 / 3, c4: 0 } },
      { time: 1, offsets: [8, 0, 8, 0, 8, 0], curve: { type: 'linear' } },
    ],
  };
  const animations: Animation[] = [{ name: 'bend', duration: 1, loop: false, timelines: [timeline] }];
  return { skeleton, animations, assetManifest: {}, timeline };
}

describe('Deform source validation and curves', () => {
  it('preserves valid native and legacy source and permits animated triangle folding', () => {
    const { timeline, ...doc } = fixture();
    timeline.keyframes[1]!.offsets = [10, 10, -20, 0, 0, -20];
    const before = structuredClone(doc);
    validateDeformTimelines(doc.skeleton, doc.animations);
    expect(deserializeDocument(serializeDocument(doc))).toEqual(before);
    const project = projectFromLegacy(doc);
    expect(deserializeProject(serializeProject(project))).toEqual(project);
    expect(doc).toEqual(before);
  });

  it('rejects broken references, wrong offset counts, nonfinite values, duplicate tracks and unsorted keys', () => {
    const mutations: ((timeline: DeformTimeline, animations: Animation[]) => void)[] = [
      (tl) => {
        tl.attachmentId = 'missing';
      },
      (tl) => {
        tl.keyframes[1]!.offsets = [1, 2];
      },
      (tl) => {
        tl.keyframes[1]!.offsets![0] = NaN;
      },
      (tl) => {
        delete tl.keyframes[1]!.offsets![1];
      },
      (tl) => {
        tl.keyframes[1]!.offsets![0] = 1e40;
      },
      (tl) => {
        tl.keyframes[1]!.time = 0;
      },
      (tl) => {
        tl.keyframes[1]!.time = -1;
      },
      (tl) => {
        tl.keyframes[1]!.time = Infinity;
      },
      (tl, animations) => {
        animations[0]!.timelines.push(structuredClone(tl));
      },
      (tl) => {
        tl.keyframes[0]!.curve = { type: 'unknown' } as unknown as Curve;
      },
      (tl) => {
        tl.keyframes[0]!.curve.c1 = -0.1;
      },
      (tl) => {
        tl.keyframes[0]!.curve.c2 = Infinity;
      },
      (tl) => {
        tl.keyframes[0]!.curve.c2 = 1e40;
      },
    ];
    for (const mutate of mutations) {
      const { timeline, ...doc } = fixture();
      mutate(timeline, doc.animations);
      expect(() => validateDeformTimelines(doc.skeleton, doc.animations)).toThrow(/Invalid Deform/);
      expect(() => deserializeDocument(serializeDocument(doc))).toThrow(/Invalid Deform/);
    }
  });

  it('samples cubic, overshooting, stepped and linear keys with null setup and crossfade', () => {
    const { skeleton: data, timeline, animations } = fixture();
    const skeleton = new Skeleton(data),
      state = skeleton.pose.attachments.get('mesh')!;
    const sample = (curve: Curve, alpha = 1) => {
      timeline.keyframes[0]!.curve = curve;
      validateDeformTimelines(data, animations);
      state.deform.fill(2);
      applyTimeline(timeline, skeleton, 0.5, 0, alpha, null, 'bend');
      return state.deform[0];
    };
    expect(sample({ type: 'bezier', c1: 1 / 3, c2: 0, c3: 2 / 3, c4: 0 })).toBeCloseTo(1, 6);
    expect(sample({ type: 'bezier', c1: 1 / 3, c2: 2, c3: 2 / 3, c4: 2 })).toBeCloseTo(13, 6);
    expect(sample({ type: 'linear' })).toBe(4);
    expect(sample({ type: 'stepped' })).toBe(0);
    expect(sample({ type: 'bezier', c1: 1 / 3, c2: 0, c3: 2 / 3, c4: 0 }, 0.25)).toBeCloseTo(1.75, 6);
  });
});
