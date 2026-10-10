import { PixiSceneRenderer as SharedPixiSceneRenderer } from '@limber/runtime-web';
import { textureRegistry } from '../engine/TextureRegistry';
export type { SceneRenderer, SceneBounds } from '@limber/runtime-web';
/** Editor guides and permissive authoring textures are injected at the app boundary. */
export class PixiSceneRenderer extends SharedPixiSceneRenderer {
  constructor() {
    super(textureRegistry, { editorGuides: true });
  }
}
