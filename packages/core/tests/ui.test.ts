import { PROJECT_SCHEMA_VERSION } from '../src/project/model';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEVICE_PRESETS,
  expandUIComponents,
  evaluateScene,
  nineSliceGrid,
  resolveSceneLayout,
  resolveUIBox,
  safeUIBox,
  uiLayout,
  validateProject,
  serializeProject,
  deserializeProject,
  type BoneByBoneProject,
  type SceneNode,
  type TextNode,
} from '../src';

import { uiBase as base, uiFixture, uiText } from './uiFixtures';

describe('responsive game UI contracts', () => {
  it('round-trips the immutable reward popup fixture across schema-3 UI primitives', () => {
    const source = readFileSync(new URL('../../../fixtures/bbbproj-v3-reward.json', import.meta.url), 'utf8');
    const project = deserializeProject(source);
    expect(project).toEqual({ ...JSON.parse(source), schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
  it('fits the same centered popup and anchored action inside four safe rectangles', () => {
    const layout = uiLayout(320, 240);
    layout.x.anchorMin = 0;
    layout.x.anchorMax = 1;
    layout.x.offsetMin = 16;
    layout.x.offsetMax = 16;
    layout.x.max = 480;
    layout.safeArea = true;
    for (const device of DEVICE_PRESETS) {
      const safe = safeUIBox(device),
        box = resolveUIBox(layout, safe);
      expect(box.width).toBe(Math.min(480, safe.width - 32));
      expect(box.x).toBe(safe.x);
      expect(box.y).toBe(safe.y);
      expect(box.x - box.width / 2).toBeGreaterThanOrEqual(safe.x - safe.width / 2 + 16);
      expect(box.x + box.width / 2).toBeLessThanOrEqual(safe.x + safe.width / 2 - 16);
    }
  });
  it('preserves pivot position under clamping and aspect fitting', () => {
    const layout = uiLayout(200, 100);
    layout.x.pivot = 0;
    layout.y.pivot = 1;
    layout.x.max = 100;
    layout.aspect = 2;
    const box = resolveUIBox(layout, { x: 10, y: 20, width: 600, height: 400 });
    expect(box).toEqual({ x: 60, y: -5, width: 100, height: 50 });
    layout.x.min = 80;
    layout.y.min = 50;
    expect(resolveUIBox(layout, { x: 0, y: 0, width: 600, height: 400 }).width).toBe(100);
  });
  it('resolves parent boxes before offsets and leaves authored setup unchanged', () => {
    const project = uiFixture(),
      board = project.artboards[0]!;
    const group: SceneNode = { ...base('group'), type: 'group', layout: uiLayout(200, 100) };
    group.layout!.x.anchorMin = group.layout!.x.anchorMax = 1;
    group.layout!.x.pivot = 1;
    group.transform.x = -10;
    const label = uiText();
    label.parentId = 'group';
    label.layout = uiLayout(20, 10);
    label.layout.x.anchorMin = label.layout.x.anchorMax = 1;
    label.layout.x.pivot = 1;
    board.nodes = [label, group];
    const before = structuredClone(board),
      evaluated = evaluateScene(board);
    expect(evaluated.find((e) => e.node.id === 'label')!.world[4]).toBe(175);
    expect(resolveSceneLayout(board).get('label')!.width).toBe(20);
    expect(board).toEqual(before);
  });
  it('keeps exact slice source borders and monotonic destination strips at small sizes', () => {
    const borders = { left: 10, right: 20, top: 4, bottom: 8 };
    const large = nineSliceGrid(64, 32, 300, 120, borders);
    expect(large.sourceX).toEqual([0, 10, 44, 64]);
    expect(large.x).toEqual([-150, -140, 130, 150]);
    const small = nineSliceGrid(64, 32, 15, 6, borders);
    expect(small.x).toEqual([-7.5, -2.5, -2.5, 7.5]);
    expect(small.y).toEqual([-3, -1, -1, 3]);
    expect(small.sourceX).toEqual(large.sourceX);
  });
  it('round-trips Unicode, layout, definitions and exact overrides without mutation', () => {
    const project = uiFixture();
    project.artboards[0]!.nodes[0]!.layout = uiLayout(300, 60);
    const json = serializeProject(project);
    expect(deserializeProject(json)).toEqual(project);
    const expanded = expandUIComponents(project, project.artboards[0]!);
    expect((expanded.artboard.nodes[1] as TextNode).text).toBe('Claim 123');
    expect(expanded.owners.get(expanded.artboard.nodes[1]!.id)).toBe('instance');
    expect(serializeProject(project)).toBe(json);
  });
  it('propagates nested definition defaults while keeping instance overrides', () => {
    const project = uiFixture(),
      board = project.artboards[0]!;
    const inner = project.components![0]!;
    const nested = { ...board.nodes[0]!, id: 'nested', overrides: {} } as SceneNode;
    project.components!.push({
      id: 'outer',
      name: 'Outer',
      revision: 1,
      width: 300,
      height: 100,
      nodes: [nested],
      exposed: [],
    });
    board.nodes.push({
      ...board.nodes[0]!,
      id: 'outer-instance',
      componentId: 'outer',
      overrides: {},
    } as SceneNode);
    (inner.nodes[0] as TextNode).text = 'Updated';
    validateProject(project);
    const expanded = expandUIComponents(project, board).artboard.nodes.filter((node) => node.type === 'text');
    expect(expanded.map((node) => node.text)).toEqual(['Claim 123', 'Updated']);
    expect(new Set(expandUIComponents(project, board).artboard.nodes.map((node) => node.id)).size).toBe(5);
  });
  it('rejects cycles, dangling/unknown overrides, invalid types and incompatible layout constraints', () => {
    const corruptions: ((p: BoneByBoneProject) => void)[] = [
      (p) => {
        p.components![0]!.nodes.push({ ...p.artboards[0]!.nodes[0]!, id: 'cycle' });
      },
      (p) => {
        p.components = [];
      },
      (p) => {
        p.components![0]!.exposed[0]!.nodeId = 'missing';
      },
      (p) => {
        Object.assign(p.artboards[0]!.nodes[0]!, { overrides: { missing: 'x' } });
      },
      (p) => {
        Object.assign(p.artboards[0]!.nodes[0]!, { overrides: { label: 123 } });
      },
      (p) => {
        Object.assign(p.components![0]!.nodes[0]!, { fontFamilies: null });
      },
      (p) => {
        const node = p.artboards[0]!.nodes[0]!;
        node.layout = uiLayout();
        node.layout.x.anchorMax = -1;
      },
      (p) => {
        const node = p.artboards[0]!.nodes[0]!;
        node.layout = uiLayout();
        node.layout.aspect = 2;
        node.layout.x.max = 10;
        node.layout.y.min = 100;
      },
      (p) => {
        p.artboards[0]!.safeArea = { left: 500, right: 0, top: 0, bottom: 0 };
      },
    ];
    for (const corrupt of corruptions) {
      const project = uiFixture();
      corrupt(project);
      expect(() => validateProject(project)).toThrow();
    }
  });
  it('counts masks through component boundaries and enforces the limit', () => {
    const project = uiFixture();
    project.components![0]!.nodes = [];
    project.components![0]!.exposed = [];
    Object.assign(project.artboards[0]!.nodes[0]!, { overrides: {} });
    for (let i = 0; i < 8; i++)
      project.components![0]!.nodes.push({
        ...base(`mask${i}`),
        type: 'mask',
        width: 100,
        height: 100,
        parentId: i ? `mask${i - 1}` : null,
      });
    expect(() => validateProject(project)).not.toThrow();
    project.artboards[0]!.nodes.push({ ...base('outer-mask'), type: 'mask', width: 100, height: 100 });
    project.artboards[0]!.nodes[0]!.parentId = 'outer-mask';
    expect(() => validateProject(project)).toThrow(/Mask nesting/);
  });
});
