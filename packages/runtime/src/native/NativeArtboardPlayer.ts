import {
  FixedStepClock,
  type EvaluatedMarker,
  type SceneMatrix,
  type UIInsets,
  type LogicRouteEvent,
  type LogicValue,
} from '@limber/core';
import { NativeRuntimeAsset, requireNativeAsset } from './NativeRuntimeAsset';
import { NativeScenePlayer, type NativeSceneSnapshot, type NativeSceneView } from './NativeScenePlayer';
import { NativeRigPlayer, type NativeFiredEvent, type NativeRigSnapshot } from './NativeRigPlayer';
import { nativeOwner, type OwnedEvent, type OwnerHooks } from './ownership';
import type { NativeAnimationOptions } from './RawPlaybackClock';
import type { RuntimeProgram } from './model';

export interface NativeArtboardEvent extends NativeFiredEvent {
  /** Global artboard tick; the inherited tick remains local to the emitting owner. */
  artboardTick: number;
}
export interface NativeArtboardSnapshot {
  playing: boolean;
  tick: number;
  scene: NativeSceneSnapshot;
  rigs: Record<string, NativeRigSnapshot>;
}

/** One clock drives the scene and all expanded characters, then publishes one skinned frame. */
export class NativeArtboardPlayer {
  readonly artboardId: string;
  readonly asset: NativeRuntimeAsset;
  readonly scene: NativeScenePlayer;
  private readonly characters = new Map<string, NativeRigPlayer>();
  private readonly owners: OwnerHooks[];
  private readonly clock = new FixedStepClock();
  private readonly listeners = new Set<(event: NativeArtboardEvent) => void>();
  private readonly pending: OwnedEvent[] = [];
  private readonly fired: NativeArtboardEvent[] = [];
  private playingValue = false;
  private advancing = false;
  private tick = 0;
  private epoch = 0;

  constructor(
    input: RuntimeProgram | NativeRuntimeAsset,
    options: { artboardId?: string; autoplay?: boolean } = {},
  ) {
    if (options.autoplay !== undefined && typeof options.autoplay !== 'boolean')
      throw new Error('Autoplay must be boolean.');
    const asset = requireNativeAsset(input);
    this.asset = asset;
    this.scene = new NativeScenePlayer(asset, { artboardId: options.artboardId });
    this.artboardId = this.scene.artboardId;
    for (const node of this.scene.getView().nodes) {
      if (node.type === 'rig')
        this.characters.set(node.id, new NativeRigPlayer(asset, node.id, { artboardId: this.artboardId }));
    }
    this.owners = [nativeOwner(this.scene), ...[...this.characters.values()].map(nativeOwner)];
    for (const owner of this.owners) owner.claim((event) => this.pending.push(event));
    if (options.autoplay) this.play();
  }
  get playing(): boolean {
    return this.playingValue;
  }
  get currentTick(): number {
    return this.tick;
  }
  get lastDiscardedSeconds(): number {
    return this.clock.lastDiscardedSeconds;
  }
  get events(): readonly NativeArtboardEvent[] {
    return structuredClone(this.fired);
  }
  getRigIds(): readonly string[] {
    return [...this.characters.keys()];
  }
  getRig(id: string): NativeRigPlayer {
    const rig = this.characters.get(id);
    if (!rig) throw new Error(`Unknown runtime character "${id}".`);
    return rig;
  }
  play(clipId?: string, options: NativeAnimationOptions = {}): void {
    if (clipId === undefined && this.playingValue) return;
    // Scene validates a requested raw clip before any sibling/root state changes.
    this.scene.play(clipId, options);
    for (const rig of this.characters.values()) rig.play();
    if (!this.playingValue) this.clock.reset();
    this.playingValue = true;
    this.invalidate();
  }
  pause(): void {
    if (
      !this.playingValue &&
      !this.scene.playing &&
      ![...this.characters.values()].some((rig) => rig.playing)
    )
      return;
    this.scene.pause();
    for (const rig of this.characters.values()) rig.pause();
    this.playingValue = false;
    this.clock.reset();
    this.invalidate();
  }
  stop(): void {
    this.scene.stop();
    for (const rig of this.characters.values()) rig.stop();
    this.resetClock();
  }
  reset(): void {
    this.scene.reset();
    for (const rig of this.characters.values()) rig.reset();
    this.resetClock();
  }
  private resetClock(): void {
    this.playingValue = false;
    this.tick = 0;
    this.clock.reset();
    this.invalidate();
  }
  private invalidate(): void {
    this.epoch++;
    this.fired.length = 0;
  }
  update(delta: number): number {
    if (this.advancing) throw new Error('Native artboard update cannot be reentrant.');
    this.fired.length = 0;
    for (const owner of this.owners) owner.clearEvents();
    if (!this.playingValue) return 0;
    return this.advance(this.clock.consume(delta), false);
  }
  step(): number {
    if (this.advancing) throw new Error('Native artboard Step cannot be reentrant.');
    if (this.playingValue) throw new Error('Pause the native artboard before Step.');
    this.fired.length = 0;
    for (const owner of this.owners) owner.clearEvents();
    this.clock.reset();
    return this.advance(1, true);
  }
  private advance(count: number, force: boolean): number {
    if (count === 0) return 0;
    this.advancing = true;
    const epoch = this.epoch;
    let accepted = 0;
    try {
      for (const owner of this.owners) owner.beginFrame();
      for (let n = 0; n < count; n++) {
        this.pending.length = 0;
        for (const owner of this.owners) owner.advance(force);
        this.tick++;
        accepted++;
        // All owners have committed this tick before either root or child host callbacks run.
        for (const record of this.pending) {
          if (this.epoch !== epoch) break;
          if (!record.current()) continue;
          const event: NativeArtboardEvent = { ...record.event, artboardTick: this.tick };
          this.fired.push(structuredClone(event));
          for (const listener of [...this.listeners]) {
            listener(structuredClone(event));
            if (this.epoch !== epoch || !record.current()) break;
          }
          if (this.epoch === epoch && record.current()) record.deliver(() => this.epoch === epoch);
        }
        if (this.epoch !== epoch) break;
      }
      return accepted;
    } finally {
      try {
        if (force) {
          this.scene.pause();
          for (const rig of this.characters.values()) rig.pause();
          this.playingValue = false;
          this.clock.reset();
        }
        for (const owner of this.owners) owner.finishFrame();
      } finally {
        this.pending.length = 0;
        this.advancing = false;
      }
    }
  }
  onEvent(listener: (event: NativeArtboardEvent) => void): () => void {
    if (typeof listener !== 'function') throw new Error('Native event listener must be a function.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  snapshot(): NativeArtboardSnapshot {
    return {
      playing: this.playingValue,
      tick: this.tick,
      scene: this.scene.snapshot(),
      rigs: Object.fromEntries([...this.characters].map(([id, rig]) => [id, rig.snapshot()])),
    };
  }
  getView(): NativeSceneView {
    return this.scene.getView();
  }
  evaluate() {
    return this.scene.evaluate();
  }
  resize(width: number, height: number, safeArea?: UIInsets): void {
    this.scene.resize(width, height, safeArea);
  }
  getMarker(rigId: string, markerId: string): EvaluatedMarker {
    const rig = this.getRig(rigId),
      node = this.evaluate().find((entry) => entry.node.id === rigId)!;
    return rig.getMarker(markerId, node.world);
  }
  getSocket(rigId: string, markerId: string): SceneMatrix {
    const marker = this.getMarker(rigId, markerId);
    if (marker.marker.kind !== 'socket') throw new Error(`Marker "${markerId}" is not a socket.`);
    return marker.world;
  }
  useLogic(): void {
    this.scene.useLogic();
    this.invalidate();
  }
  setLogicEnabled(enabled: boolean): void {
    this.scene.setLogicEnabled(enabled);
    this.invalidate();
  }
  getParameter(name: string): LogicValue {
    return this.scene.getParameter(name);
  }
  setBool(name: string, value: boolean): void {
    this.scene.setBool(name, value);
  }
  setFloat(name: string, value: number): void {
    this.scene.setFloat(name, value);
  }
  setInt(name: string, value: number): void {
    this.scene.setInt(name, value);
  }
  setString(name: string, value: string): void {
    this.scene.setString(name, value);
  }
  fire(name: string): void {
    this.scene.fire(name);
  }
  resetTrigger(name: string): void {
    this.scene.resetTrigger(name);
  }
  dispatch(event: LogicRouteEvent, renderedId: string | null = null): number {
    return this.scene.dispatch(event, renderedId);
  }
}
