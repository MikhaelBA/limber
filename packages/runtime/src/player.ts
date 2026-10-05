import type { EventFrame, ExportedDocument } from '@sprine/core';
import { Skeleton, solveFK } from '@sprine/core';

export interface RuntimePlayerOptions {
  /** Default loop setting for animations started without an explicit loop flag (Phase 3). */
  loopDefault?: boolean;
}

export interface AnimationStartOptions {
  loop?: boolean;
  /** Crossfade length in seconds (Phase 3). */
  fadeDuration?: number;
}

const notImplemented = (phase: string): Error =>
  new Error(`@sprine/runtime: not implemented yet — lands in ${phase} (see DESIGN.md §6).`);

/**
 * Phase 1 stub of the runtime API surface (DESIGN.md §6). The API is defined
 * NOW so the editor's export format and the core mixer stay compatible with it.
 *
 * What already works: constructing from a deserialized document and reading
 * world transforms (setup pose, FK-solved). Everything animation-related throws
 * until the Phase 3 mixer lands.
 */
export class RuntimePlayer {
  private readonly skeleton: Skeleton;

  constructor(doc: ExportedDocument, _atlas?: unknown) {
    this.skeleton = new Skeleton(doc.skeleton);
    this.update(0);
  }

  /**
   * Integrate. Call once per frame with your engine's delta (seconds).
   * Currently refreshes world transforms only; drives the AnimationState in Phase 3.
   */
  update(_deltaSeconds: number): void {
    solveFK(this.skeleton.data, this.skeleton.boneIndexMap, this.skeleton.pose);
  }

  /**
   * Live view of the world transform array (6 floats per bone: [a, b, c, d, tx, ty]).
   * Do not retain or mutate — contents are rewritten by update().
   */
  getWorldTransforms(): Float32Array {
    return this.skeleton.pose.worldMatrices;
  }

  getDeformedVertices(_attachmentId: string): Float32Array {
    throw notImplemented('Phase 5');
  }

  render(_container: unknown): void {
    throw notImplemented('Phase 8');
  }

  setAnimation(_name: string, _opts?: AnimationStartOptions): never {
    throw notImplemented('Phase 3');
  }

  addAnimation(_name: string, _opts?: AnimationStartOptions & { delay?: number }): never {
    throw notImplemented('Phase 3');
  }

  onEvent(_cb: (e: EventFrame) => void): () => void {
    throw notImplemented('Phase 8');
  }
}
