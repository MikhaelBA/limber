import {
  AnimationState,
  Skeleton,
  createPose,
  resetPose,
  solveFK,
  solveIK,
  updateSkinning,
  uuid,
  type Animation,
  type BoneData,
  type EditorDocument,
  type EventFrame,
  type SkeletonData,
} from '@limber/core';

export type EditorMode = 'setup' | 'animate';

type TransientListener = (value: number) => void;

function makeRootBone(): BoneData {
  return {
    id: uuid(),
    name: 'root',
    parentId: null,
    length: 80,
    setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  };
}

export function emptySkeletonData(withRoot: boolean): SkeletonData {
  return {
    bones: withRoot ? [makeRootBone()] : [],
    slots: [],
    attachments: [],
    ikConstraints: [],
    skins: [],
    activeSkin: '',
  };
}

/**
 * Mutable document/pose owner (DESIGN.md §5.1). DOM-free and Pixi-free on
 * purpose: commands and unit tests run against it in plain Node.
 *
 * The CLOCK lives here, never in Zustand — currentTime updates per frame and
 * must not re-render React subscribers (§8.4). The timeline reads it through
 * the transient 'time' channel instead.
 */
export class EditorEngine {
  document: EditorDocument;
  skeleton: Skeleton;
  animState = new AnimationState();
  activeAnimationName: string | null = null;
  mode: EditorMode = 'setup';
  currentTime = 0;
  playing = false;
  playbackSpeed = 1;
  /** Reusable event buffer from the last tick (Phase 8 wires UI to this). */
  readonly lastEvents: EventFrame[] = [];

  private transient = new Map<string, Set<TransientListener>>();

  constructor() {
    const data = emptySkeletonData(true);
    this.document = { skeleton: data, animations: [], assetManifest: {} };
    this.skeleton = new Skeleton(data);
  }

  newDocument(): void {
    const data = emptySkeletonData(true);
    this.document = { skeleton: data, animations: [], assetManifest: {} };
    this.skeleton = new Skeleton(data);
    this.resetAnimationState();
  }

  loadDocument(doc: EditorDocument): void {
    this.document = doc;
    this.skeleton = new Skeleton(doc.skeleton);
    this.resetAnimationState();
  }

  get currentAnimation(): Animation | null {
    if (!this.activeAnimationName) return null;
    return this.document.animations.find((a) => a.name === this.activeAnimationName) ?? null;
  }

  /** Selects an animation (or null) and rewinds the clock. */
  setAnimation(name: string | null): void {
    this.activeAnimationName = name;
    this.currentTime = 0;
    const anim = this.currentAnimation;
    if (anim) this.animState.setAnimation(anim, { loop: anim.loop, fadeDuration: 0 });
    else this.animState.clear();
    this.playing = false;
  }

  play(): void {
    if (this.currentAnimation) this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  stop(): void {
    this.playing = false;
    this.currentTime = 0;
    this.animState.scrub(0);
  }

  /** Moves the playhead (pauses playback — scrubbing while playing is chaos). */
  scrub(time: number): void {
    this.playing = false;
    const dur = this.currentAnimation?.duration ?? 0;
    this.currentTime = Math.min(Math.max(time, 0), dur);
    this.animState.scrub(this.currentTime);
  }

  /**
   * Per-frame pipeline (DESIGN.md §4.3, Phase 3 + Phase 5 MESH step):
   * reset → apply animation (animate mode only) → FK → skin attachments.
   * (IK slots in between when Phase 6 lands.)
   */
  tick(deltaMS: number): void {
    const dt = Math.min(deltaMS, 100) / 1000;
    if (this.playing && this.animState.hasCurrent) {
      this.animState.update(dt * this.playbackSpeed);
      this.currentTime = this.animState.time;
    } else {
      this.animState.scrub(this.currentTime);
    }

    resetPose(this.skeleton.data, this.skeleton.pose);
    if (this.mode === 'animate' && this.animState.hasCurrent) {
      const events = this.animState.apply(this.skeleton);
      this.lastEvents.length = 0;
      for (const e of events) this.lastEvents.push(e);
    }
    solveFK(this.skeleton.data, this.skeleton.boneIndexMap, this.skeleton.pose);
    // IK reads the FK'd world matrices, writes LOCAL rotations and refreshes
    // the world matrices itself (constraint order matters; solveIK is safe to
    // call even with zero constraints).
    if (this.skeleton.data.ikConstraints.length > 0) {
      solveIK(this.skeleton.data, this.skeleton.boneIndexMap, this.skeleton.pose);
    }
    updateSkinning(this.skeleton);
    this.emitTransient('time', this.currentTime);
  }

  /**
   * World matrices of the SETUP pose. Editing-time helper for world-preserving
   * reparents — allocates a fresh pose, so never call it per frame.
   */
  solveSetupWorlds(): Float32Array {
    const pose = createPose(this.skeleton.data);
    solveFK(this.skeleton.data, this.skeleton.boneIndexMap, pose);
    return pose.worldMatrices;
  }

  onTransient(channel: string, cb: TransientListener): () => void {
    let set = this.transient.get(channel);
    if (!set) {
      set = new Set();
      this.transient.set(channel, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  private emitTransient(channel: string, value: number): void {
    const set = this.transient.get(channel);
    if (!set) return;
    for (const cb of set) cb(value);
  }

  private resetAnimationState(): void {
    this.activeAnimationName = null;
    this.currentTime = 0;
    this.playing = false;
    this.mode = 'setup';
    this.animState.clear();
  }
}
