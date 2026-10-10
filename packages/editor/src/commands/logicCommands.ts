import {
  validateProject,
  type BoneByBoneProject,
  type LogicGraph,
  type LogicParameter,
  type LogicState,
  type LogicTransition,
} from '@limber/core';
import type { Command } from '../history/history';
export interface LogicOwner {
  artboardId: string;
  rigId: string | null;
}
export type LogicEdit =
  | { kind: 'create'; graph: LogicGraph }
  | { kind: 'removeGraph' }
  | { kind: 'settings'; patch: Partial<Pick<LogicGraph, 'name' | 'enabled' | 'entryStateId'>> }
  | { kind: 'addParameter'; parameter: LogicParameter }
  | { kind: 'parameter'; id: string; parameter: LogicParameter }
  | { kind: 'removeParameter'; id: string }
  | { kind: 'addState'; state: LogicState }
  | { kind: 'state'; id: string; patch: Partial<Omit<LogicState, 'id'>> }
  | { kind: 'removeState'; id: string }
  | { kind: 'addTransition'; transition: LogicTransition }
  | { kind: 'transition'; id: string; patch: Partial<Omit<LogicTransition, 'id'>> }
  | { kind: 'removeTransition'; id: string };
function requireIndex(values: readonly { id: string }[], id: string, label: string): number {
  const index = values.findIndex((v) => v.id === id);
  if (index < 0) throw new Error(`${label} no longer exists.`);
  return index;
}
function patchAllowed(target: object, patch: object, keys: readonly string[]): void {
  for (const key of Object.keys(patch))
    if (!keys.includes(key)) throw new Error(`Unsupported Logic edit field ${key}.`);
  Object.assign(target, patch);
}
/** Graph-only copy-on-write transaction; existing rig/clip payload identities survive. */
export class EditLogicCommand implements Command {
  readonly scope = 'project' as const;
  readonly label = 'Edit Logic graph';
  private before: LogicGraph | undefined;
  private after: LogicGraph | undefined;
  private prepared = false;
  private readonly owner: LogicOwner;
  private readonly intent: LogicEdit;
  constructor(
    private project: BoneByBoneProject,
    owner: LogicOwner,
    intent: LogicEdit,
  ) {
    this.owner = { ...owner };
    this.intent = structuredClone(intent);
  }
  private container() {
    const board = this.project.artboards.find((a) => a.id === this.owner.artboardId);
    if (!board) throw new Error('Logic artboard no longer exists.');
    if (this.owner.rigId === null) return board;
    const rig = board.nodes.find((n) => n.id === this.owner.rigId && n.type === 'rig');
    if (!rig || rig.type !== 'rig') throw new Error('Logic rig no longer exists.');
    return rig;
  }
  do(): void {
    const container = this.container();
    if (!this.prepared) {
      const edit = this.intent;
      let after: LogicGraph | undefined;
      if (edit.kind === 'create') {
        if (container.logic) throw new Error('This owner already has a Logic graph.');
        after = structuredClone(edit.graph);
      } else {
        if (!container.logic) throw new Error('Create a Logic graph first.');
        after = structuredClone(container.logic);
        switch (edit.kind) {
          case 'removeGraph':
            after = undefined;
            break;
          case 'settings':
            patchAllowed(after, edit.patch, ['name', 'enabled', 'entryStateId']);
            break;
          case 'addParameter':
            after.parameters.push(edit.parameter);
            break;
          case 'parameter': {
            const index = requireIndex(after.parameters, edit.id, 'Parameter');
            if (edit.parameter.id !== edit.id) throw new Error('Parameter identity cannot change.');
            after.parameters[index] = edit.parameter;
            break;
          }
          case 'removeParameter': {
            requireIndex(after.parameters, edit.id, 'Parameter');
            after.parameters = after.parameters.filter((p) => p.id !== edit.id);
            // Remove dependent edges instead of silently weakening their guards.
            after.transitions = after.transitions.filter(
              (t) => !t.conditions.some((c) => c.parameterId === edit.id),
            );
            break;
          }
          case 'addState':
            after.states.push(edit.state);
            break;
          case 'state':
            patchAllowed(after.states[requireIndex(after.states, edit.id, 'State')]!, edit.patch, [
              'name',
              'clip',
              'loop',
              'position',
            ]);
            break;
          case 'removeState': {
            requireIndex(after.states, edit.id, 'State');
            if (after.states.length === 1) throw new Error('Keep at least one Logic state.');
            after.states = after.states.filter((s) => s.id !== edit.id);
            after.transitions = after.transitions.filter((t) => t.from !== edit.id && t.to !== edit.id);
            if (after.entryStateId === edit.id) after.entryStateId = after.states[0]!.id;
            break;
          }
          case 'addTransition':
            after.transitions.push(edit.transition);
            break;
          case 'transition':
            patchAllowed(
              after.transitions[requireIndex(after.transitions, edit.id, 'Transition')]!,
              edit.patch,
              ['from', 'to', 'priority', 'conditions', 'exitTime', 'blendDuration', 'interruption'],
            );
            break;
          case 'removeTransition':
            requireIndex(after.transitions, edit.id, 'Transition');
            after.transitions = after.transitions.filter((t) => t.id !== edit.id);
            break;
        }
      }
      const artboards = this.project.artboards.map((a) =>
        a.id !== this.owner.artboardId
          ? a
          : this.owner.rigId === null
            ? { ...a, logic: after }
            : { ...a, nodes: a.nodes.map((n) => (n.id === this.owner.rigId ? { ...n, logic: after } : n)) },
      );
      validateProject({ ...this.project, artboards });
      this.before = container.logic;
      this.after = after;
      this.prepared = true;
    }
    if (this.after === undefined) delete container.logic;
    else container.logic = this.after;
  }
  undo(): void {
    if (!this.prepared) return;
    const container = this.container();
    if (this.before === undefined) delete container.logic;
    else container.logic = this.before;
  }
}
