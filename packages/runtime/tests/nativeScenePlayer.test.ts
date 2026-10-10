import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deserializeProject,
  SceneLogicPlayer,
  expandUIComponents,
  sceneTransform,
  uiLayout,
  SECONDARY_STEP_SECONDS as STEP,
  type SceneNode,
  type BoneByBoneProject,
} from '@limber/core';
import {
  compileRuntime,
  loadRuntime,
  NativeScenePlayer,
  type RuntimeProgram,
  type NativeFiredEvent,
} from '@limber/runtime';

function source(): BoneByBoneProject {
  return deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
  );
}
function rawProgram(): RuntimeProgram {
  const program = loadRuntime(
    readFileSync(new URL('../../../fixtures/bbb-v1-minimal.bbb', import.meta.url), 'utf8'),
  );
  const board = program.artboards[0]!,
    from = board.clips![0]!;
  board.nodes[0]!.transform.x = 10;
  board.nodes[0]!.opacity = 0.6;
  const tracks = (x: number, rotation: number, scaleX: number, opacity: number, pivotX: number) =>
    Object.entries({ x, rotation, scaleX, opacity, pivotX }).map(([property, value]) => ({
      nodeId: 'box',
      property: property as 'x' | 'rotation' | 'scaleX' | 'opacity' | 'pivotX',
      keys: [{ time: 0, value, curve: { type: 'stepped' as const } }],
    }));
  from.loop = false;
  from.tracks = tracks(100, (170 * Math.PI) / 180, 2, 0.2, 3);
  from.events.unshift({ time: 0, name: 'entry', payload: { type: 'int', value: 1 } });
  board.clips!.push({
    id: 'to',
    name: from.name,
    duration: 0.2,
    loop: false,
    tracks: tracks(200, (-170 * Math.PI) / 180, 4, 0.8, 7),
    events: [{ time: 0, name: 'to-entry', payload: { type: 'bool', value: true } }],
  });
  return program;
}
function normalized(nodes: SceneNode[]): SceneNode[] {
  const copy = structuredClone(nodes);
  for (const node of copy)
    if (node.type === 'rig') for (const state of node.logic?.states ?? []) delete state.position;
  return copy;
}
function steps(player: NativeScenePlayer, count: number): void {
  for (let i = 0; i < count; i++) expect(player.step()).toBe(1);
}

describe('native scene playback and responsive expanded UI', () => {
  it('addresses raw clips by stable ID, with full transform/opacity shortest-arc fade goldens', () => {
    const program = rawProgram(),
      before = structuredClone(program),
      player = new NativeScenePlayer(program);
    expect(player.playing).toBe(false);
    expect(player.getView().nodes[0]!.transform.x).toBe(10);
    player.play('slide');
    player.play('to', { fadeDuration: 0.2 });
    player.pause();
    steps(player, 12);
    const node = player.getView().nodes[0]!;
    expect(node.transform.x).toBe(150);
    expect(node.transform.rotation).toBeCloseTo(Math.PI, 12);
    expect(node.transform.scaleX).toBe(3);
    expect(node.transform.pivotX).toBe(5);
    expect(node.opacity).toBe(0.5);
    expect(player.evaluate()[0]!.world[4]).toBeCloseTo(165, 10);
    expect(player.getView()).not.toHaveProperty('clips');
    expect(player.getView()).not.toHaveProperty('logic');
    expect(program).toEqual(before);
  });

  it('shares FIFO delay/terminal/entry ordering with character playback and holds loop endpoints', () => {
    const player = new NativeScenePlayer(rawProgram()),
      events: NativeFiredEvent[] = [];
    player.onEvent((e) => events.push(e));
    player.play('slide', { loop: true });
    player.queueAnimation('to', { delay: 2 * STEP });
    player.pause();
    steps(player, 24);
    expect(player.snapshot().time).toBe(0.2);
    expect(events.map((e) => e.eventName)).toEqual(['entry', 'arrived']);
    steps(player, 2);
    expect(player.snapshot().clip).toBe('slide');
    player.step();
    expect(player.snapshot().clip).toBe('to');
    expect(events.map((e) => e.eventName)).toEqual(['entry', 'arrived', 'to-entry']);
    expect(events.map((e) => e.clipId)).toEqual(['slide', 'slide', 'to']);
    expect(events.every((e) => e.ownerId === 'board')).toBe(true);
  });

  it('preserves accepted-tick scene matrices, opacity and events across display groupings', () => {
    const program = rawProgram(),
      a = new NativeScenePlayer(program),
      b = new NativeScenePlayer(program);
    const x: NativeFiredEvent[] = [],
      y: NativeFiredEvent[] = [];
    a.onEvent((e) => x.push(e));
    b.onEvent((e) => y.push(e));
    for (const player of [a, b]) {
      player.play('slide');
      player.queueAnimation('to', { fadeDuration: 0.2 });
    }
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    for (let i = 0; i < 10; i++) b.update(0.1);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.getView()).toEqual(a.getView());
    expect(b.evaluate()).toEqual(a.evaluate());
    expect(y).toEqual(x);
  });

  it('reuses a cached view on held/zero-delta frames and advances at most twelve ticks', () => {
    const player = new NativeScenePlayer(rawProgram());
    player.play('slide');
    const view = player.getView();
    expect(player.getView()).toBe(view);
    expect(player.update(0)).toBe(0);
    expect(player.getView()).toBe(view);
    expect(player.update(STEP / 2)).toBe(0);
    expect(player.getView()).toBe(view);
    player.play();
    expect(player.update(STEP / 2)).toBe(1);
    expect(player.getView()).not.toBe(view);
    expect(player.update(10)).toBe(12);
    expect(player.lastDiscardedSeconds).toBe(9.9);
    const state = player.snapshot();
    expect(() => player.step()).toThrow(/Pause/);
    expect(player.snapshot()).toEqual(state);
  });

  it('matches source Logic, exposure bindings, events and expanded node ownership', () => {
    const project = source(),
      before = structuredClone(project),
      program = compileRuntime(project).program;
    const native = new NativeScenePlayer(program),
      core = new SceneLogicPlayer(project.artboards[0]!, project.components);
    core.pause();
    const eventsA: unknown[] = [],
      eventsB: unknown[] = [];
    native.onEvent((e) => {
      const { ownerId: _owner, ...event } = e;
      eventsA.push(event);
    });
    core.onEvent((e) => eventsB.push(e));
    const label = native
      .getView()
      .nodes.find((n) => n.type === 'text' && native.getNodeOwner(n.id) === 'instance')!;
    expect(native.dispatch('click', label.id)).toBe(core.dispatch('click', 'instance'));
    for (let i = 0; i < 120; i++) {
      native.step();
      core.step();
      expect(native.snapshot().logic).toEqual(core.snapshot());
      expect(normalized(native.getView({ expanded: false }).nodes)).toEqual(normalized(core.getView().nodes));
      expect(normalized(native.getView().nodes)).toEqual(
        normalized(expandUIComponents(project, core.getView()).artboard.nodes),
      );
    }
    expect(eventsA).toEqual(eventsB);
    expect(project).toEqual(before);
    expect(() => native.dispatch('click', 'missing')).toThrow(/Unknown runtime node/);
  });

  it('applies all four exposed domains and direct text bindings without changing stored overrides', () => {
    const project = source(),
      before = structuredClone(project),
      player = new NativeScenePlayer(compileRuntime(project).program);
    player.setString('caption', 'Changed 🦊');
    player.setBool('shown', false);
    player.setFloat('alpha', 0.25);
    player.setInt('color', 0xabcdef);
    player.step();
    const nodes = player.getView().nodes;
    const text = nodes.find((n) => n.type === 'text' && player.getNodeOwner(n.id) === 'instance')!;
    expect(text.type).toBe('text');
    if (text.type !== 'text') throw new Error('Missing text.');
    expect(text.text).toBe('Changed 🦊');
    expect(text.visible).toBe(false);
    expect(text.opacity).toBe(0.25);
    expect(text.tint).toBe(0xabcdef);
    const direct = nodes.find((n) => n.id === 'direct')!;
    if (direct.type !== 'text') throw new Error('Missing direct text.');
    expect(direct.text).toBe('Changed 🦊');
    expect(project).toEqual(before);
    const state = player.snapshot();
    expect(() => player.setFloat('alpha', 1.1)).toThrow();
    expect(() => player.setInt('color', -1)).toThrow();
    expect(player.snapshot()).toEqual(state);
    player.setLogicEnabled(false);
    const held = player.getView();
    expect(player.step()).toBe(0);
    expect(player.getView()).toBe(held);
    player.fire('pressed');
    player.setLogicEnabled(true);
    expect(player.step()).toBe(1);
  });

  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [1024, 768],
    [1280, 720],
  ])
    it(`${width}×${height}: resolves safe-area responsive layout without altering source`, () => {
      const project = source(),
        instance = project.artboards[0]!.nodes.find((n) => n.id === 'instance')!;
      instance.layout = uiLayout(280, 80);
      instance.layout.safeArea = true;
      instance.layout.x.anchorMin = 0;
      instance.layout.x.anchorMax = 1;
      instance.layout.x.offsetMin = 10;
      instance.layout.x.offsetMax = 20;
      const before = structuredClone(project),
        player = new NativeScenePlayer(compileRuntime(project).program);
      const safe = { left: 10, right: 20, top: 30, bottom: 40 };
      player.resize(width!, height!, safe);
      safe.left = 999;
      const evaluated = player.evaluate().find((n) => n.node.id === 'instance')!;
      expect(evaluated.box.width).toBe(width! - 60);
      expect(evaluated.box.x).toBe(-10);
      expect(evaluated.box.height).toBe(80);
      expect(player.getView().safeArea!.left).toBe(10);
      expect(project).toEqual(before);
    });

  it('retains masks, nine-slice borders and text metadata in the native view', () => {
    const project = source(),
      board = project.artboards[0]!,
      textureId = Object.keys(project.assetManifest)[0]!;
    const common = { parentId: null, transform: sceneTransform(), opacity: 1, visible: true };
    board.nodes.push(
      { ...common, id: 'mask', name: 'Mask', type: 'mask', width: 200, height: 100 },
      {
        ...common,
        parentId: 'mask',
        id: 'panel',
        name: 'Panel',
        type: 'nineSlice',
        width: 180,
        height: 80,
        sourceWidth: 128,
        sourceHeight: 128,
        textureId,
        borders: { left: 20, right: 20, top: 20, bottom: 20 },
      },
    );
    const player = new NativeScenePlayer(compileRuntime(project).program);
    const panel = player.getView().nodes.find((n) => n.id === 'panel')!;
    expect(panel).toMatchObject({
      parentId: 'mask',
      sourceWidth: 128,
      sourceHeight: 128,
      borders: { left: 20, right: 20, top: 20, bottom: 20 },
    });
    expect(player.evaluate().find((n) => n.node.id === 'panel')!.depth).toBe(1);
  });

  it('validates resizing and playback before changing the viewport or current mode', () => {
    const player = new NativeScenePlayer(rawProgram()),
      view = player.getView(),
      state = player.snapshot();
    for (const request of [
      () => player.resize(0, 100),
      () => player.resize('400' as unknown as number, 100),
      () => player.resize(100, 100, { left: 90, right: 20, top: 0, bottom: 0 }),
      () => player.resize(100, 100, null as unknown as undefined),
      () => player.play('missing'),
      () => player.play('slide', { fadeDuration: NaN }),
      () => player.useLogic(),
    ]) {
      expect(request).toThrow();
      expect(player.snapshot()).toEqual(state);
      expect(player.getView()).toBe(view);
    }
  });

  it('restores authored setup on Stop, fresh Logic on reset and keeps host viewport dimensions', () => {
    const project = source(),
      player = new NativeScenePlayer(compileRuntime(project).program);
    player.resize(1280, 720);
    player.setString('caption', 'transient');
    player.step();
    player.play('reveal');
    player.pause();
    player.step();
    player.stop();
    expect(normalized(player.getView({ expanded: false }).nodes)).toEqual(
      normalized(project.artboards[0]!.nodes),
    );
    expect(player.getView().width).toBe(1280);
    player.queueAnimation('reveal');
    expect(player.playing).toBe(true);
    player.pause();
    player.step();
    player.reset();
    expect(player.mode).toBe('logic');
    expect(player.currentTick).toBe(0);
    expect(player.playing).toBe(false);
    expect(player.getParameter('caption')).toBe('سلام 🌿');
    expect(player.getView().width).toBe(1280);
  });

  it('isolates callback copies, stops stale delivery and keeps callback-selected tracks paused after Step', () => {
    const player = new NativeScenePlayer(rawProgram()),
      seen: NativeFiredEvent[] = [];
    player.onEvent((e) => {
      if (typeof e.payload === 'object') e.payload.value = 99;
    });
    player.onEvent((e) => seen.push(e));
    player.play('slide');
    player.pause();
    player.step();
    expect(seen[0]!.payload).toEqual({ type: 'int', value: 1 });
    expect(player.events[0]!.payload).toEqual({ type: 'int', value: 1 });
    const stopped = new NativeScenePlayer(rawProgram()),
      names: string[] = [];
    stopped.onEvent((e) => {
      names.push(e.eventName);
      stopped.stop();
    });
    stopped.onEvent(() => names.push('stale'));
    stopped.play('slide');
    expect(stopped.update(0.1)).toBe(1);
    expect(names).toEqual(['entry']);
    expect(stopped.currentTick).toBe(0);
    const switched = new NativeScenePlayer(rawProgram());
    switched.onEvent(() => {
      expect(() => switched.update(STEP)).toThrow(/reentrant/);
      switched.play('to');
    });
    switched.play('slide');
    switched.pause();
    switched.step();
    expect(switched.snapshot().clip).toBe('to');
    expect(switched.playing).toBe(false);
  });
});
