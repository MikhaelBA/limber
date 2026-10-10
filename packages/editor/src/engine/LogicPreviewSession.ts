import {
  SceneLogicPlayer,
  RigLogicPlayer,
  validateProject,
  type BoneByBoneProject,
  type Artboard,
  type LogicInput,
  type LogicRouteEvent,
  type LogicFiredEvent,
  type Skeleton,
} from '@limber/core';
import type { LogicOwner } from '../commands/logicCommands';
/** Immutable preview publication; every source edit constructs a fresh paused session. */
export class LogicPreviewSession {
  readonly board: Artboard;
  readonly scene: SceneLogicPlayer | null;
  readonly rigs = new Map<string, RigLogicPlayer>();
  readonly skeletons = new Map<string, Skeleton>();
  readonly owner: LogicOwner;
  readonly recentEvents: { ownerId: string; event: LogicFiredEvent }[] = [];
  private playingValue = false;
  constructor(project: BoneByBoneProject, owner: LogicOwner) {
    this.owner = { ...owner };
    validateProject(project);
    const source = project.artboards.find((a) => a.id === owner.artboardId);
    if (!source) throw new Error('Logic artboard no longer exists.');
    this.board = structuredClone(source);
    this.scene =
      owner.rigId === null && this.board.logic ? new SceneLogicPlayer(this.board, project.components) : null;
    if (owner.rigId !== null && !this.board.nodes.some((n) => n.type === 'rig' && n.id === owner.rigId))
      throw new Error('Logic rig no longer exists.');
    for (const node of this.board.nodes)
      if (node.type === 'rig' && node.logic && (owner.rigId === null || owner.rigId === node.id)) {
        const player = new RigLogicPlayer(node);
        this.rigs.set(node.id, player);
        this.skeletons.set(node.id, player.skeleton);
      }
    if (this.scene) this.bindEvents(this.scene, this.board.id);
    for (const [id, player] of this.rigs) this.bindEvents(player, id);
    this.pause();
  }
  private bindEvents(player: SceneLogicPlayer | RigLogicPlayer, ownerId: string): void {
    player.onEvent((event) => {
      this.recentEvents.push({ ownerId, event: structuredClone(event) });
      if (this.recentEvents.length > 24) this.recentEvents.shift();
    });
  }
  get player(): SceneLogicPlayer | RigLogicPlayer | null {
    return this.owner.rigId === null ? this.scene : (this.rigs.get(this.owner.rigId) ?? null);
  }
  get playing(): boolean {
    return this.playingValue;
  }
  get view(): Artboard {
    return this.scene?.getView() ?? this.board;
  }
  private players(): (SceneLogicPlayer | RigLogicPlayer)[] {
    return [...(this.scene ? [this.scene] : []), ...this.rigs.values()];
  }
  play(): void {
    this.playingValue = true;
    for (const player of this.players()) player.play();
  }
  pause(): void {
    this.playingValue = false;
    for (const player of this.players()) player.pause();
  }
  reset(): void {
    for (const player of this.players()) player.reset();
    this.recentEvents.length = 0;
  }
  advance(seconds: number): void {
    if (this.playingValue) for (const player of this.players()) player.update(seconds);
  }
  step(): void {
    if (this.playing) throw new Error('Pause the preview before stepping.');
    for (const player of this.players()) player.step();
  }
  input(input: LogicInput): void {
    this.player?.applyInput(input);
  }
  dispatch(event: LogicRouteEvent, targetId: string | null = null): number {
    return this.player?.dispatch(event, this.owner.rigId === null ? targetId : null) ?? 0;
  }
  setEnabled(value: boolean): void {
    this.player?.setEnabled(value);
  }
}
