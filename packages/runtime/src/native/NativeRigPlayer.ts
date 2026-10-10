import {
  RigLogicPlayer,
  resetPose,
  solveFK,
  solveConstraints,
  updateSkinning,
  evaluateMarkers,
  type RigNode,
  type Skeleton,
  type SceneMatrix,
  type EvaluatedMarker,
  type LogicFiredEvent,
  type LogicSnapshot,
  type LogicRouteEvent,
  type LogicValue,
} from '@limber/core';
import {
  NativeRuntimeAsset,
  nativeAssetState,
  nativeRigSource,
  requireNativeAsset,
} from './NativeRuntimeAsset';
import { registerNativeOwner, type OwnedEvent } from './ownership';
import { SECONDARY_STEP_SECONDS } from '@limber/core';
import { runtimeFail, type RuntimeProgram } from './model';
import {
  RawRigPlayback,
  type NativeAnimationOptions,
  type NativeQueuedAnimationOptions,
} from './rawRigPlayback';

export type NativeRigMode = 'logic' | 'animation';
export interface NativeFiredEvent extends LogicFiredEvent {
  ownerId: string;
}
export interface NativeRigSnapshot {
  mode: NativeRigMode;
  playing: boolean;
  tick: number;
  clip: string | null;
  time: number;
  queued: number;
  blendProgress: number;
  logic?: LogicSnapshot;
}
class NativeLogicRigPlayback extends RigLogicPlayer {
  private overrides?: ReadonlyMap<string, string | null>;
  deferSkinning = false;
  constructor(source: RigNode, overrides: ReadonlyMap<string, string | null>) {
    super(source);
    this.overrides = overrides;
  }
  protected override finishFrame(): void {
    // The base constructor initializes before subclass fields; there are no overrides yet.
    for (const [id, attachment] of this.overrides ?? [])
      this.skeleton.pose.slots[this.skeleton.slotIndexMap.get(id)!]!.attachmentId = attachment;
    if (!this.deferSkinning) super.finishFrame();
  }
}

/** Validated native character playback. All working state is detached from the compiled program. */
export class NativeRigPlayer {
  readonly rigId: string;
  readonly artboardId: string;
  private readonly source: RigNode;
  private readonly logic: NativeLogicRigPlayback | null;
  private raw: RawRigPlayback | null = null;
  private modeValue: NativeRigMode;
  private playingValue = false;
  private stopped = false;
  private advancing = false;
  private epoch = 0;
  private skin: string;
  private readonly attachments = new Map<string, string | null>();
  private readonly listeners = new Set<(event: NativeFiredEvent) => void>();
  private readonly fired: NativeFiredEvent[] = [];
  private ownedEvents: ((event: OwnedEvent) => void) | null = null;
  private ownerAdvance = false;
  private deferSkinning = false;

  constructor(
    program: RuntimeProgram | NativeRuntimeAsset,
    rigId: string,
    options: { artboardId?: string; autoplay?: boolean } = {},
  ) {
    if (options.autoplay !== undefined && typeof options.autoplay !== 'boolean')
      throw new Error('Autoplay must be boolean.');
    const asset = requireNativeAsset(program),
      { program: validated } = nativeAssetState(asset);
    this.artboardId = options.artboardId ?? validated.defaultArtboardId;
    const rig = nativeRigSource(asset, this.artboardId, rigId);
    if (!rig) runtimeFail('MISSING_RIG', 'Requested rig does not exist in this runtime artboard.', rigId);
    this.source = rig;
    this.rigId = rig.id;
    this.skin = rig.skeleton.activeSkin;
    this.logic = rig.logic ? new NativeLogicRigPlayback(rig, this.attachments) : null;
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
        if (this.ownedEvents) throw new Error('Native rig already has an artboard owner.');
        this.ownedEvents = events;
      },
      beginFrame: () => {
        this.fired.length = 0;
        this.deferSkinning = true;
        if (this.raw) this.raw.deferSkinning = true;
        if (this.logic) this.logic.deferSkinning = true;
      },
      finishFrame: () => {
        this.deferSkinning = false;
        if (this.raw) this.raw.deferSkinning = false;
        if (this.logic) this.logic.deferSkinning = false;
        this.finishFailedCallbackFrame();
      },
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
  get mode(): NativeRigMode {
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
    return this.source.animations.find((clip) => clip.name === snapshot.clip)?.timelines.length ?? 0;
  }
  /** Read-only adapter view. Buffers are live; do not mutate or replace them. */
  get skeleton(): Skeleton {
    return this.adapter().skeleton;
  }
  get currentTick(): number {
    return this.adapter().currentTick;
  }
  get lastDiscardedSeconds(): number {
    return this.adapter().lastDiscardedSeconds;
  }
  /** Isolated events from the last update/Step, without exposing internal callback buffers. */
  get events(): readonly NativeFiredEvent[] {
    return structuredClone(this.fired);
  }
  private adapter(): NativeLogicRigPlayback | RawRigPlayback {
    return this.modeValue === 'logic' ? this.requireLogic() : this.requireRaw();
  }
  private requireRaw(): RawRigPlayback {
    if (!this.raw) {
      this.raw = new RawRigPlayback(this.source, this.attachments);
      this.raw.deferSkinning = this.deferSkinning;
      this.raw.setSkin(this.skin);
      this.raw.onEvent((event) => this.emit('animation', event));
    }
    return this.raw;
  }
  private requireLogic(): NativeLogicRigPlayback {
    if (!this.logic || this.modeValue !== 'logic')
      throw new Error('Select an authored rig Logic graph before using Logic controls.');
    return this.logic;
  }
  play(name?: string, options: NativeAnimationOptions = {}): void {
    if (name === undefined && this.playingValue) return;
    if (name !== undefined) {
      const raw = this.requireRaw();
      raw.play(name, options); // Validate before changing the active mode.
      this.logic?.pause();
      this.modeValue = 'animation';
    } else {
      const adapter = this.adapter();
      adapter.play();
      if (this.stopped && this.modeValue === 'logic') adapter.update(0);
    }
    this.stopped = false;
    this.playingValue = true;
    this.epoch++;
    this.fired.length = 0;
  }
  queueAnimation(name: string, options: NativeQueuedAnimationOptions = {}): void {
    if (this.modeValue !== 'animation')
      throw new Error('Select raw animation playback before queuing clips.');
    this.requireRaw().queueAnimation(name, options);
    this.playingValue = this.requireRaw().playing;
    if (this.requireRaw().currentAnimation !== null) this.stopped = false;
  }
  useLogic(): void {
    if (!this.logic) throw new Error('This character has no authored Logic graph.');
    this.raw?.pause();
    this.modeValue = 'logic';
    this.logic.reset();
    if (this.playingValue) this.logic.play();
    else this.logic.pause();
    this.stopped = false;
    this.epoch++;
    this.fired.length = 0;
  }
  pause(): void {
    if (!this.playingValue) return;
    this.adapter().pause();
    this.playingValue = false;
    this.epoch++;
    this.fired.length = 0;
  }
  stop(): void {
    this.playingValue = false;
    this.epoch++;
    this.fired.length = 0;
    this.stopped = true;
    if (this.modeValue === 'animation') this.requireRaw().stop();
    else {
      this.logic!.reset();
      this.logic!.pause();
      this.restoreStoppedSetup();
    }
  }
  /** Restore authored defaults and a paused initial session, clearing host overrides. */
  reset(): void {
    this.attachments.clear();
    this.skin = this.source.skeleton.activeSkin;
    this.raw?.setSkin(this.skin);
    this.raw?.stop();
    if (this.logic) {
      this.logic.setSkin(this.skin);
      this.logic.reset();
      this.logic.pause();
    }
    this.modeValue = this.logic ? 'logic' : 'animation';
    this.stopped = false;
    this.playingValue = false;
    this.epoch++;
    this.fired.length = 0;
  }
  private restoreStoppedSetup(): void {
    const skeleton = this.skeleton;
    resetPose(skeleton.data, skeleton.pose, this.skin);
    solveFK(skeleton.data, skeleton.boneIndexMap, skeleton.pose);
    solveConstraints(skeleton);
    skeleton.secondaryMotion?.rebase(skeleton);
    for (const [slot, attachment] of this.attachments)
      skeleton.pose.slots[skeleton.slotIndexMap.get(slot)!]!.attachmentId = attachment;
    if (!this.deferSkinning) updateSkinning(skeleton);
  }
  update(delta: number): number {
    if (this.ownedEvents && !this.ownerAdvance)
      throw new Error('Advance this owned character through its native artboard.');
    if (this.advancing) throw new Error('Native rig update cannot be reentrant.');
    if (!this.ownerAdvance) this.fired.length = 0;
    if (!this.playingValue) return 0;
    this.advancing = true;
    try {
      return this.adapter().update(delta);
    } catch (error) {
      this.finishFailedCallbackFrame();
      throw error;
    } finally {
      this.advancing = false;
    }
  }
  step(): number {
    if (this.ownedEvents && !this.ownerAdvance)
      throw new Error('Step this owned character through its native artboard.');
    if (this.advancing) throw new Error('Native rig Step cannot be reentrant.');
    if (this.playingValue) throw new Error('Pause the native rig before Step.');
    if (!this.ownerAdvance) this.fired.length = 0;
    this.stopped = false;
    this.advancing = true;
    try {
      return this.adapter().step();
    } catch (error) {
      this.finishFailedCallbackFrame();
      throw error;
    } finally {
      // A callback can select another mode/clip; Step still leaves the resulting player paused.
      if (this.adapter().playing) this.adapter().pause();
      this.playingValue = false;
      this.advancing = false;
    }
  }
  /** Host callback exceptions propagate, while the already accepted pose remains coherent. */
  private finishFailedCallbackFrame(): void {
    const skeleton = this.skeleton;
    for (const [slot, attachment] of this.attachments)
      skeleton.pose.slots[skeleton.slotIndexMap.get(slot)!]!.attachmentId = attachment;
    if (!this.deferSkinning) updateSkinning(skeleton);
  }
  snapshot(): NativeRigSnapshot {
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
      clip: raw.currentAnimation,
      time: raw.time,
      queued: raw.queueLength,
      blendProgress: raw.blendProgress,
    };
  }
  private emit(mode: NativeRigMode, event: LogicFiredEvent): void {
    if (mode !== this.modeValue) return;
    const emitted = { ...structuredClone(event), ownerId: this.rigId },
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
  setSkin(name: string): void {
    if (name !== '' && !this.source.skeleton.skins.some((s) => s.name === name))
      throw new Error(`Unknown skin "${name}".`);
    this.skin = name;
    this.raw?.setSkin(name);
    this.logic?.setSkin(name);
    if (this.stopped) this.restoreStoppedSetup();
  }
  private requireSlot(id: string): void {
    if (!this.source.skeleton.slots.some((slot) => slot.id === id)) throw new Error(`Unknown slot "${id}".`);
  }
  setAttachment(slotId: string, attachmentId: string | null): void {
    this.requireSlot(slotId);
    if (attachmentId !== null && !this.source.skeleton.attachments.some((a) => a.id === attachmentId))
      throw new Error(`Unknown attachment "${attachmentId}".`);
    this.attachments.set(slotId, attachmentId);
    this.refreshAttachments();
  }
  clearAttachmentOverride(slotId: string): void {
    this.requireSlot(slotId);
    this.attachments.delete(slotId);
    this.refreshAttachments();
  }
  private refreshAttachments(): void {
    if (this.modeValue === 'animation') this.requireRaw().refreshAttachments();
    else this.requireLogic().setSkin(this.skin);
    if (this.stopped) this.restoreStoppedSetup();
  }
  resetSecondaryMotion(): void {
    this.adapter().resetSecondaryMotion();
  }
  getWorldTransforms(): Float32Array {
    return this.skeleton.pose.worldMatrices;
  }
  getDeformedVertices(id: string): Float32Array {
    const state = this.skeleton.pose.attachments.get(id);
    if (!state) throw new Error(`Unknown attachment "${id}".`);
    return state.verts;
  }
  getSlotAttachment(slotId: string): string | null {
    this.requireSlot(slotId);
    return this.skeleton.pose.slots[this.skeleton.slotIndexMap.get(slotId)!]!.attachmentId;
  }
  getSlotColor(slotId: string): number {
    this.requireSlot(slotId);
    return this.skeleton.pose.slots[this.skeleton.slotIndexMap.get(slotId)!]!.color;
  }
  getDrawOrder(): readonly number[] {
    return this.skeleton.pose.slotOrder;
  }
  getMarker(id: string, rigWorld?: SceneMatrix): EvaluatedMarker {
    if (rigWorld !== undefined && (rigWorld.length !== 6 || !rigWorld.every(Number.isFinite)))
      throw new Error('Rig world transform must contain six finite matrix entries.');
    const result = evaluateMarkers(
      this.skeleton.data,
      this.skeleton.pose,
      this.skeleton.boneIndexMap,
      rigWorld,
    ).find((marker) => marker.marker.id === id);
    if (!result) throw new Error(`Unknown marker "${id}".`);
    return structuredClone(result);
  }
  getSocket(id: string, rigWorld?: SceneMatrix): SceneMatrix {
    const marker = this.getMarker(id, rigWorld);
    if (marker.marker.kind !== 'socket') throw new Error(`Marker "${id}" is not a socket.`);
    return marker.world;
  }
  setLogicEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('Logic enablement must be boolean.');
    this.requireLogic().setEnabled(enabled);
    if (this.stopped) this.restoreStoppedSetup();
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
  dispatch(event: LogicRouteEvent): number {
    return this.requireLogic().dispatch(event, null);
  }
}
