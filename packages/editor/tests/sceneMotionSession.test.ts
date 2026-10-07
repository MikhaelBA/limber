import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '@limber/core';
import { SceneMotionSession } from '../src/engine/SceneMotionSession';
const fixture = () =>
  deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v2-motion.json', import.meta.url), 'utf8'),
  );

describe('scene preview session', () => {
  it('streams playback frames without React-style change notifications or source mutations', () => {
    const project = fixture(),
      before = serializeProject(project),
      session = new SceneMotionSession(() => project.artboards[0]!);
    let changes = 0,
      frames = 0;
    session.subscribe(() => changes++);
    session.onFrame(() => frames++);
    session.select('motion');
    session.play();
    const atStart = changes;
    for (let i = 0; i < 100; i++) session.advance(0.01);
    expect(changes).toBe(atStart);
    expect(frames).toBeGreaterThanOrEqual(100);
    expect(serializeProject(project)).toBe(before);
    expect(session.recentEvents.map((event) => event.name)).toEqual(['start', 'middle', 'end', 'start']);
  });
  it('keeps unkeyed previews transient and clears them on scrub, setup, play and project context changes', () => {
    const project = fixture();
    let board = project.artboards[0]!;
    const session = new SceneMotionSession(() => board);
    session.select('motion');
    session.scrub(0.5);
    const transform = { ...session.view().nodes[0]!.transform, x: 250 };
    const draft = () =>
      session.setDraft({ transforms: { 'image-0': transform }, opacity: { 'image-1': 0.1 } });
    draft();
    expect(session.view().nodes[0]!.transform.x).toBe(250);
    expect(board.nodes[0]!.transform.x).not.toBe(250);
    session.scrub(0.5);
    expect(session.view().nodes[0]!.transform.x).toBe(50);
    draft();
    session.setEnabled(false);
    session.setEnabled(true);
    expect(session.view().nodes[0]!.transform.x).toBe(50);
    draft();
    session.play();
    expect(session.view().nodes[0]!.transform.x).toBe(50);
    board = { ...board, id: 'other' };
    session.refresh();
    expect(session.clip).toBeNull();
    expect(session.enabled).toBe(false);
  });
});
