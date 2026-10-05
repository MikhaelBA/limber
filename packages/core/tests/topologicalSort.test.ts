import { describe, expect, it } from 'vitest';
import { topologicalSortBones } from '@sprine/core';
import { makeBone } from './helpers';

describe('topologicalSortBones', () => {
  it('sorts parents before children regardless of input order', () => {
    const bones = [
      makeBone('grandchild', 'child'),
      makeBone('child', 'root'),
      makeBone('root', null),
    ];
    const sorted = topologicalSortBones(bones);
    expect(sorted.map((b) => b.id)).toEqual(['root', 'child', 'grandchild']);
  });

  it('keeps an already-sorted input in exactly the same order', () => {
    const bones = [
      makeBone('root', null),
      makeBone('child', 'root'),
      makeBone('grandchild', 'child'),
      makeBone('otherRoot', null),
    ];
    const sorted = topologicalSortBones(bones);
    expect(sorted.map((b) => b.id)).toEqual(['root', 'child', 'grandchild', 'otherRoot']);
  });

  it('is deterministic — same input, same output', () => {
    const bones = [
      makeBone('b', 'a'),
      makeBone('c', 'a'),
      makeBone('a', null),
    ];
    const first = topologicalSortBones([...bones]).map((b) => b.id);
    const second = topologicalSortBones([...bones]).map((b) => b.id);
    expect(first).toEqual(second);
    expect(first.indexOf('a')).toBeLessThan(first.indexOf('b'));
    expect(first.indexOf('a')).toBeLessThan(first.indexOf('c'));
  });

  it('throws on unknown parentId', () => {
    const bones = [makeBone('orphan', 'ghost')];
    expect(() => topologicalSortBones(bones)).toThrow(/unknown parentId "ghost"/);
  });

  it('throws on duplicate ids', () => {
    const bones = [makeBone('dup', null), makeBone('dup', null)];
    expect(() => topologicalSortBones(bones)).toThrow(/Duplicate bone id/);
  });

  it('throws on cycles and names the bones involved', () => {
    const bones = [makeBone('a', 'b'), makeBone('b', 'a'), makeBone('free', null)];
    expect(() => topologicalSortBones(bones)).toThrow(/cycle involving: a, b/);
  });
});
