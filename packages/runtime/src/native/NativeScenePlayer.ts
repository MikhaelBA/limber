import {
  SceneLogicPlayer,
  expandUIComponents,
  evaluateScene,
  SECONDARY_STEP_SECONDS,
  type Artboard,
  type UIComponent,
  type UIInsets,
  type EvaluatedSceneNode,
  type LogicFiredEvent,
  type LogicSnapshot,
  type LogicRouteEvent,
  type LogicValue,
} from '@limber/core';
import { NativeRuntimeAsset, nativeAssetState, requireNativeAsset } from './NativeRuntimeAsset';
import { registerNativeOwner, type OwnedEvent } from './ownership';
import { runtimeFail, type RuntimeProgram } from './model';
import { RawScenePlayback } from './rawScenePlayback';
import type { NativeAnimationOptions, NativeQueuedAnimationOptions } from './RawPlaybackClock';
import type { NativeFiredEvent } from './NativeRigPlayer';

export type NativeSceneMode = 'logic' | 'animation';
/** Rendering view, without private sampling tracks, FPS, selection identities or graph authoring. */
export type NativeSceneView = Pick<Artboard, 'id' | 'name' | 'width' | 'height' | 'safeArea' | 'nodes'>;
export interface NativeSceneSnapshot {
  mode: NativeSceneMode;
  playing: boolean;
  tick: number;
  clip: string | null;
  time: number;
  queued: number;
  blendProgress: number;
  logic?: LogicSnapshot;
}

/** Native scene animation/Logic and expanded responsive UI; character orchestration is separate. */
export class NativeScenePlayer {
  readonly artboardId: string;
  private readonly board: Artboard;
  private readonly components: UIComponent[];
  private readonly logic: SceneLogicPlayer | null;
  private raw: RawScenePlayback | null = null;
  private modeValue: NativeSceneMode;
  private playingValue = false;
  private stopped = false;
  private advancing = false;
  private epoch = 0;
  private width: number;
  private height: number;
  private safeArea: UIInsets | undefined;
  private viewDirty = true;
  private authoredView!: NativeSceneView;
  private expandedView!: NativeSceneView;
  private owners = new Map<string, string>();
  private readonly listeners = new Set<(event: NativeFiredEvent) => void>();
  private readonly fired: NativeFiredEvent[] = [];
  private ownedEvents: ((event: OwnedEvent) => void) | null = null;
  private ownerAdvance = false;
  constructor(
    program: RuntimeProgram | NativeRuntimeAsset,
    options: { artboardId?: string; autoplay?: boolean } = {},
  ) {
    if (options.autoplay !== undefined && typeof options.autoplay !== 'boolean')
      throw new Error('Autoplay must be boolean.');
    const { program: validated, project } = nativeAssetState(requireNativeAsset(program));
    this.artboardId = options.artboardId ?? validated.defaultArtboardId;
    const board = project.artboards.find((b) => b.id === this.artboardId);
    if (!board)
      runtimeFail('MISSING_ARTBOARD', 'Requested runtime artboard does not exist.', this.artboardId);
    this.board = structuredClone(board);
    this.components = structuredClone(project.components ?? []);
    this.width = board.width;
    this.height = board.height;
    this.safeArea = this.board.safeArea;
    this.logic = board.logic ? new SceneLogicPlayer(board, this.components) : null;
    this.modeValue = this.logic ? 'logic' : 'animation';
    if (this.logic) {
      this.logic.pause();
      this.logic.onEvent((event) => this.emit('logic', event));
    } else this.requireRaw();
    if (options.autoplay) this.play();
    registerNativeOwner(this, {
      clearEvents: () => {
        this.fired.length = 0;
      },
      claim: (events) => {
        if (this.ownedEvents) throw new Error('Native scene already has an artboard owner.');
        this.ownedEvents = events;
      },
      beginFrame: () => {
        this.fired.length = 0;
      },
      finishFrame: () => {},
      advance: (force) => {
        this.ownerAdvance = true;
        try {
          if (force) {
            if (this.playingValue) this.pause();
            return this.step();
          }
          return this.update(SECONDARY_STEP_SECONDS);
        } finally {
          this.ownerAdvance = false;
        }
      },
    });
  }
  get mode(): NativeSceneMode {
    return this.modeValue;
  }
  get playing(): boolean {
    return this.playingValue;
  }
  /** Incoming selected timelines; paused poses retain selection, Stop/disabled Logic do not. */
  get activeTrackCount(): number {
    if (this.stopped) return 0;
    const snapshot = this.snapshot();
    if (snapshot.logic && !snapshot.logic.enabled) return 0;
    return this.board.clips?.find((clip) => clip.id === snapshot.clip)?.tracks.length ?? 0;
  }
  get currentTick(): number {
    return this.adapter().currentTick;
  }
  get lastDiscardedSeconds(): number {
    return this.adapter().lastDiscardedSeconds;
  }
  get events(): readonly NativeFiredEvent[] {
    return structuredClone(this.fired);
  }
  private adapter(): SceneLogicPlayer | RawScenePlayback {
    return this.modeValue === 'logic' ? this.requireLogic() : this.requireRaw();
  }
  private requireRaw(): RawScenePlayback {
    if (!this.raw) {
      this.raw = new RawScenePlayback(this.board);
      this.raw.onEvent((event) => this.emit('animation', event));
    }
    return this.raw;
  }
  private requireLogic(): SceneLogicPlayer {
    if (!this.logic || this.modeValue !== 'logic')
      throw new Error('Select an authored artboard Logic graph before using Logic controls.');
    return this.logic;
  }
  play(clipId?: string, options: NativeAnimationOptions = {}): void {
    if (clipId === undefined && this.playingValue) return;
    if (clipId !== undefined) {
      this.requireRaw().play(clipId, options);
      this.logic?.pause();
      this.modeValue = 'animation';
    } else {
      this.adapter().play();
      if (this.stopped && this.modeValue === 'logic') this.adapter().update(0);
    }
    this.stopped = false;
    this.playingValue = true;
    this.epoch++;
    this.fired.length = 0;
    this.viewDirty = true;
  }
  queueAnimation(clipId: string, options: NativeQueuedAnimationOptions = {}): void {
    if (this.modeValue !== 'animation') throw new Error('Select raw scene playback before queuing clips.');
    this.requireRaw().queueAnimation(clipId, options);
    this.playingValue = this.requireRaw().playing;
    if (this.requireRaw().currentClip !== null) this.stopped = false;
    this.viewDirty = true;
  }
  useLogic(): void {
    if (!this.logic) throw new Error('This artboard has no authored Logic graph.');
    this.raw?.pause();
    this.modeValue = 'logic';
    this.logic.reset();
    if (this.playingValue) this.logic.play();
    else this.logic.pause();
    this.stopped = false;
    this.epoch++;
    this.fired.length = 0;
    this.viewDirty = true;
  }
  pause(): void {
    if (!this.playingValue) return;
    this.adapter().pause();
    this.playingValue = false;
    this.epoch++;
    this.fired.length = 0;
    this.viewDirty = true;
  }
  stop(): void {
    this.playingValue = false;
    this.stopped = true;
    this.epoch++;
    this.fired.length = 0;
    if (this.modeValue === 'animation') this.requireRaw().stop();
    else {
      this.logic!.reset();
      this.logic!.pause();
    }
    this.viewDirty = true;
  }
  reset(): void {
    this.raw?.stop();
    if (this.logic) {
      this.logic.reset();
      this.logic.pause();
    }
    this.modeValue = this.logic ? 'logic' : 'animation';
    this.playingValue = false;
    this.stopped = false;
    this.epoch++;
    this.fired.length = 0;
    this.viewDirty = true;
  }
  update(delta: number): number {
    if (this.ownedEvents && !this.ownerAdvance)
      throw new Error('Advance this owned scene through its native artboard.');
    if (this.advancing) throw new Error('Native scene update cannot be reentrant.');
    if (!this.ownerAdvance) this.fired.length = 0;
    if (!this.playingValue) return 0;
    this.advancing = true;
    const previousTick = this.adapter().currentTick;
    try {
      const accepted = this.adapter().update(delta);
      if (accepted > 0) this.viewDirty = true;
      return accepted;
    } finally {
      this.advancing = false;
      if (this.adapter().currentTick !== previousTick) this.viewDirty = true;
    }
  }
  step(): number {
    if (this.ownedEvents && !this.ownerAdvance)
      throw new Error('Step this owned scene through its native artboard.');
    if (this.advancing) throw new Error('Native scene Step cannot be reentrant.');
    if (this.playingValue) throw new Error('Pause the native scene before Step.');
    if (!this.ownerAdvance) this.fired.length = 0;
    if (this.stopped) this.viewDirty = true;
    this.stopped = false;
    this.advancing = true;
    const previousTick = this.adapter().currentTick;
    try {
      const accepted = this.adapter().step();
      if (accepted > 0) this.viewDirty = true;
      return accepted;
    } finally {
      if (this.adapter().playing) this.adapter().pause();
      this.playingValue = false;
      this.advancing = false;
      if (this.adapter().currentTick !== previousTick) this.viewDirty = true;
    }
  }
  snapshot(): NativeSceneSnapshot {
    if (this.modeValue === 'logic') {
      const logic = this.requireLogic().snapshot();
      return {
        mode: this.modeValue,
        playing: this.playingValue,
        tick: logic.tick,
        clip: logic.clip,
        time: logic.clipTime,
        queued: 0,
        blendProgress: logic.transition?.progress ?? 1,
        logic,
      };
    }
    const raw = this.requireRaw();
    return {
      mode: this.modeValue,
      playing: this.playingValue,
      tick: raw.currentTick,
      clip: raw.currentClip,
      time: raw.time,
      queued: raw.queueLength,
      blendProgress: raw.blendProgress,
    };
  }
  private refreshView(): void {
    if (!this.viewDirty) return;
    const view = this.stopped ? this.board : this.adapter().getView();
    this.authoredView = {
      id: view.id,
      name: view.name,
      nodes: view.nodes,
      width: this.width,
      height: this.height,
      ...(this.safeArea === undefined ? {} : { safeArea: this.safeArea }),
    };
    const expanded = expandUIComponents({ components: this.components }, this.authoredView);
    this.expandedView = expanded.artboard;
    this.owners = expanded.owners;
    this.viewDirty = false;
  }
  /** Read-only cached render view. Expanded IDs follow the portable component path contract. */
  getView(options: { expanded?: boolean } = {}): NativeSceneView {
    this.refreshView();
    return options.expanded === false ? this.authoredView : this.expandedView;
  }
  getNodeOwner(renderedId: string): string {
    this.refreshView();
    const owner = this.owners.get(renderedId);
    if (!owner) throw new Error(`Unknown runtime node "${renderedId}".`);
    return owner;
  }
  evaluate(): EvaluatedSceneNode[] {
    return evaluateScene(this.getView());
  }
  resize(width: number, height: number, safeArea: UIInsets | undefined = this.safeArea): void {
    if (![width, height].every((n) => typeof n === 'number' && Number.isFinite(Math.fround(n)) && n >= 1))
      throw new Error('Runtime viewport dimensions must be positive finite pixels.');
    if (safeArea !== undefined && (!safeArea || typeof safeArea !== 'object' || Array.isArray(safeArea)))
      throw new Error('Runtime safe area must contain four numeric insets.');
    if (safeArea) {
      if (
        Object.keys(safeArea).sort().join(',') !== 'bottom,left,right,top' ||
        !Object.values(safeArea).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) ||
        safeArea.left + safeArea.right > width ||
        safeArea.top + safeArea.bottom > height
      )
        throw new Error('Runtime safe area must fit the viewport.');
    }
    this.width = width;
    this.height = height;
    this.safeArea = safeArea ? { ...safeArea } : undefined;
    this.viewDirty = true;
  }
  private emit(mode: NativeSceneMode, event: LogicFiredEvent): void {
    if (mode !== this.modeValue) return;
    this.viewDirty = true;
    const emitted = { ...structuredClone(event), ownerId: this.artboardId },
      epoch = this.epoch;
    this.fired.push(structuredClone(emitted));
    if (this.ownedEvents && this.ownerAdvance) {
      this.ownedEvents({
        event: emitted,
        current: () => this.epoch === epoch && this.modeValue === mode,
        deliver: (current) => {
          if (this.epoch === epoch && this.modeValue === mode) this.deliverEvent(emitted, epoch, current);
        },
      });
      return;
    }
    this.deliverEvent(emitted, epoch);
  }
  private deliverEvent(emitted: NativeFiredEvent, epoch: number, current: () => boolean = () => true): void {
    for (const listener of [...this.listeners]) {
      listener(structuredClone(emitted));
      if (this.epoch !== epoch || !current()) break;
    }
  }
  onEvent(listener: (event: NativeFiredEvent) => void): () => void {
    if (typeof listener !== 'function') throw new Error('Native event listener must be a function.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setLogicEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('Logic enablement must be boolean.');
    this.requireLogic().setEnabled(enabled);
    this.viewDirty = true;
  }
  getParameter(name: string): LogicValue {
    return this.requireLogic().getParameter(name);
  }
  setBool(name: string, value: boolean): void {
    this.requireLogic().setBool(name, value);
  }
  setFloat(name: string, value: number): void {
    this.requireLogic().setFloat(name, value);
  }
  setInt(name: string, value: number): void {
    this.requireLogic().setInt(name, value);
  }
  setString(name: string, value: string): void {
    this.requireLogic().setString(name, value);
  }
  fire(name: string): void {
    this.requireLogic().fire(name);
  }
  resetTrigger(name: string): void {
    this.requireLogic().resetTrigger(name);
  }
  dispatch(event: LogicRouteEvent, renderedId: string | null = null): number {
    if (this.modeValue !== 'logic' || !this.logic) return 0;
    return this.logic.dispatch(event, renderedId === null ? null : this.getNodeOwner(renderedId));
  }
}
