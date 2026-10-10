import { describe, it, expect } from 'vitest';
import {
  SceneLogicPlayer,
  LogicMachine,
  LogicSceneBindings,
  validateLogicGraph,
  validateProject,
  serializeProject,
  deserializeProject,
  projectFromLegacy,
  activeRigNode,
  sceneTransform,
  expandUIComponents,
  evaluateScene,
  type TextNode,
  type LogicGraph,
  type LogicBinding,
  type UIComponent,
} from '../src/index';
import { makeBone, makeSkeletonData } from './helpers';
const text = (id: string, binding?: string): TextNode => ({
  id,
  name: id,
  type: 'text',
  parentId: null,
  transform: sceneTransform(),
  visible: true,
  opacity: 0.75,
  text: 'Authored',
  width: 200,
  height: 80,
  fontFamilies: ['Noto Sans Arabic'],
  fontSize: 20,
  lineHeight: 24,
  direction: 'rtl',
  align: 'start',
  color: 0xffffff,
  ...(binding === undefined ? {} : { binding }),
});
function source() {
  const p = projectFromLegacy({
    skeleton: makeSkeletonData([makeBone('bone', null)]),
    animations: [],
    assetManifest: {},
  });
  const board = p.artboards[0]!;
  const definition: UIComponent = {
    id: 'definition',
    name: 'Component',
    revision: 1,
    width: 200,
    height: 80,
    nodes: [text('child', 'dormant-component-name')],
    exposed: [
      { name: 'label', nodeId: 'child', property: 'text' },
      { name: 'shown', nodeId: 'child', property: 'visible' },
      { name: 'alpha', nodeId: 'child', property: 'opacity' },
      { name: 'color', nodeId: 'child', property: 'tint' },
    ],
  };
  p.components = [definition];
  board.nodes.push(
    {
      id: 'instance',
      name: 'Instance',
      type: 'instance',
      componentId: 'definition',
      parentId: null,
      transform: sceneTransform(),
      visible: true,
      opacity: 1,
      width: 200,
      height: 80,
      overrides: { label: 'Stored override', alpha: 0.9 },
    },
    text('direct', 'label'),
  );
  board.logic = {
    id: 'graph',
    name: 'Bindings',
    enabled: true,
    entryStateId: 'entry',
    states: [{ id: 'entry', name: 'Entry', clip: 'clip', loop: false }],
    transitions: [],
    parameters: [
      { id: 'label', name: 'label', type: 'string', initial: 'سلام 🌿' },
      { id: 'shown', name: 'shown', type: 'bool', initial: true },
      { id: 'alpha', name: 'alpha', type: 'float', initial: 0.5 },
      { id: 'color', name: 'color', type: 'int', initial: 0x123456 },
    ],
    bindings: ['text', 'visible', 'opacity', 'tint'].map((property, i) => ({
      id: `bind-${i}`,
      parameterId: ['label', 'shown', 'alpha', 'color'][i]!,
      instanceId: 'instance',
      exposureName: ['label', 'shown', 'alpha', 'color'][i]!,
      property,
    })) as LogicBinding[],
  };
  board.clips = [
    {
      id: 'clip',
      name: 'Fade',
      duration: 1,
      fps: 30,
      loop: false,
      events: [],
      tracks: [
        {
          id: 'track',
          nodeId: 'instance',
          property: 'opacity',
          keys: [{ id: 'key', time: 0, value: 0.8, curve: { type: 'stepped' } }],
        },
      ],
    },
  ];
  return p;
}
const catalog = new Map([['clip', { duration: 1 }]]);
describe('one-way portable Logic bindings', () => {
  it('applies all four exposed types and direct text after animation, without changing source or overrides', () => {
    const p = source(),
      before = structuredClone(p),
      board = p.artboards[0]!,
      player = new SceneLogicPlayer(board, p.components);
    const view = player.getView(),
      instance = view.nodes.find((n) => n.id === 'instance')!;
    expect(instance.opacity).toBe(0.8);
    if (instance.type !== 'instance') throw new Error('Missing instance');
    expect(instance.overrides).toEqual({ label: 'سلام 🌿', shown: true, alpha: 0.5, color: 0x123456 });
    expect((view.nodes.find((n) => n.id === 'direct') as TextNode).text).toBe('سلام 🌿');
    const expanded = expandUIComponents(p, view).artboard;
    const child = expanded.nodes.find((n) => n.type === 'text' && n.id !== 'direct')!;
    expect((child as TextNode).text).toBe('سلام 🌿');
    expect(evaluateScene(expanded).find((n) => n.node.id === child.id)!.opacity).toBeCloseTo(0.4, 12);
    expect(p).toEqual(before);
    expect(deserializeProject(serializeProject(p))).toEqual(before);
  });
  it('publishes valid setter data next tick and rejects raw/canonical domain errors atomically', () => {
    const p = source(),
      player = new SceneLogicPlayer(p.artboards[0]!, p.components);
    player.setFloat('alpha', 0.25);
    player.setInt('color', 0xffffff);
    player.setBool('shown', false);
    player.setString('label', 'Updated');
    expect(player.getParameter('alpha')).toBe(0.5);
    for (const value of [-0.01, 1.000000001])
      expect(() => player.setFloat('alpha', value)).toThrow(/\[0,1\]/);
    for (const value of [-1, 0x1000000]) expect(() => player.setInt('color', value)).toThrow(/0xffffff/);
    player.update(1 / 120);
    const node = player.getView().nodes.find((n) => n.type === 'instance')!;
    if (node.type !== 'instance') throw new Error('Missing instance');
    expect(node.overrides).toEqual({ label: 'Updated', shown: false, alpha: 0.25, color: 0xffffff });
    player.setFloat('alpha', 0.1);
    player.update(1 / 120);
    expect(player.getParameter('alpha')).toBe(Math.fround(0.1));
    const machine = new LogicMachine(p.artboards[0]!.logic!, catalog);
    expect(() => machine.setFloat('alpha', 1.1)).toThrow(/\[0,1\]/);
    expect(machine.snapshot().parameters.alpha).toBe(0.5);
  });
  it('restores authored view while disabled, retains pending input and defaults on reset', () => {
    const p = source(),
      before = structuredClone(p),
      player = new SceneLogicPlayer(p.artboards[0]!, p.components);
    player.setString('label', 'Held');
    player.update(1 / 120);
    player.setEnabled(false);
    const setup = player.getView(),
      instance = setup.nodes.find((n) => n.type === 'instance')!;
    expect(instance.opacity).toBe(1);
    if (instance.type !== 'instance') throw new Error('Missing instance');
    expect(instance.overrides).toEqual({ label: 'Stored override', alpha: 0.9 });
    expect((setup.nodes.find((n) => n.id === 'direct') as TextNode).text).toBe('Authored');
    player.setString('label', 'Pending');
    expect(player.update(3)).toBe(0);
    player.setEnabled(true);
    expect((player.getView().nodes.find((n) => n.id === 'direct') as TextNode).text).toBe('Held');
    player.update(1 / 120);
    expect((player.getView().nodes.find((n) => n.id === 'direct') as TextNode).text).toBe('Pending');
    player.reset();
    expect((player.getView().nodes.find((n) => n.id === 'direct') as TextNode).text).toBe('سلام 🌿');
    expect(p).toEqual(before);
  });
  it('rejects malformed structural bindings and incompatible initial values with actionable validator codes', () => {
    const mutations: ((g: LogicGraph) => void)[] = [
      (g) => {
        g.bindings = null as never;
      },
      (g) => {
        g.bindings![0]!.parameterId = 'missing';
      },
      (g) => {
        g.bindings![0]!.property = 'unknown' as never;
      },
      (g) => {
        g.bindings![0]!.parameterId = 'shown';
      },
      (g) => {
        g.bindings![0]!.id = 'entry';
      },
      (g) => {
        g.bindings!.push({ ...g.bindings![0]!, id: 'duplicate-target' });
      },
      (g) => {
        (g.parameters[2]! as { initial: number }).initial = 1.1;
      },
      (g) => {
        (g.parameters[3]! as { initial: number }).initial = 0x1000000;
      },
      (g) => {
        g.bindings = new Array(257).fill(g.bindings![0]!);
      },
      (g) => {
        g.bindings![0] = { ...g.bindings![0]!, expression: 'ignored code' } as never;
      },
    ];
    for (const mutate of mutations) {
      const graph = structuredClone(source().artboards[0]!.logic!);
      mutate(graph);
      const before = structuredClone(graph);
      expect(() => validateLogicGraph(graph, catalog)).toThrow();
      expect(graph).toEqual(before);
    }
  });
  it('validates references/property changes and direct text names even for disabled native graphs', () => {
    const mutations = [
      (p: ReturnType<typeof source>) => {
        p.artboards[0]!.logic!.bindings![0]!.instanceId = 'direct';
      },
      (p: ReturnType<typeof source>) => {
        p.artboards[0]!.logic!.bindings![0]!.exposureName = 'missing';
      },
      (p: ReturnType<typeof source>) => {
        p.components![0]!.exposed[0]!.property = 'visible';
      },
      (p: ReturnType<typeof source>) => {
        (p.artboards[0]!.nodes.find((n) => n.id === 'direct') as TextNode).binding = 'missing';
      },
      (p: ReturnType<typeof source>) => {
        (p.artboards[0]!.nodes.find((n) => n.id === 'direct') as TextNode).binding = 'shown';
      },
    ];
    for (const mutate of mutations) {
      const p = source();
      p.artboards[0]!.logic!.enabled = false;
      mutate(p);
      const before = structuredClone(p);
      expect(() => validateProject(p)).toThrow();
      expect(p).toEqual(before);
    }
    const dormant = source();
    delete dormant.artboards[0]!.logic;
    expect(() => validateProject(dormant)).not.toThrow();
    const rig = activeRigNode(dormant)!;
    rig.logic = {
      ...source().artboards[0]!.logic!,
      states: [{ id: 'entry', name: 'Entry', clip: null, loop: false }],
    };
    expect(() => validateProject(dormant)).toThrow(/artboard Logic/);
  });
  it('isolates definitions/baked projections and rejects forged values or changed views without partial mutation', () => {
    const p = source(),
      board = p.artboards[0]!,
      player = new SceneLogicPlayer(board, p.components);
    p.components![0]!.exposed[0]!.name = 'changed';
    expect(
      (player.getView().nodes.find((n) => n.type === 'instance') as { overrides: Record<string, unknown> })
        .overrides.label,
    ).toBe('سلام 🌿');
    const clean = source(),
      bindings = new LogicSceneBindings(clean.artboards[0]!.logic!, clean.artboards[0]!, clean.components);
    const view = structuredClone(clean.artboards[0]!),
      before = structuredClone(view),
      values = { label: 'ok', shown: true, alpha: 0.5, color: 1 };
    expect(() => bindings.apply(view, { ...values, alpha: 2 })).toThrow(/\[0,1\]/);
    expect(view).toEqual(before);
    const missing = { ...view, nodes: view.nodes.filter((n) => n.id !== 'direct') },
      missingBefore = structuredClone(missing);
    expect(() => bindings.apply(missing, values)).toThrow(/Rebuild text/);
    expect(missing).toEqual(missingBefore);
  });
});
