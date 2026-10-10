import { RigSceneDisplay as SharedRigSceneDisplay } from '@limber/runtime-web';
import type { Skeleton } from '@limber/core';
import { textureRegistry } from '../engine/TextureRegistry';
export class RigSceneDisplay extends SharedRigSceneDisplay {
  constructor(skeleton: Skeleton) {
    super(skeleton, textureRegistry, true);
  }
}
