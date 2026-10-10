import { prepareNativeAtlas, compileNativeProject } from '../src/engine/nativeAtlasJob';
import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, sceneTransform } from '@limber/core';
import { loadRuntime, NativeRuntimeAsset } from '@limber/runtime';
import { NativeWebAssets, rasterizeUIText } from '@limber/runtime-web';
Object.assign(globalThis, {
  prepareNativeAtlas,
  compileNativeProject,
  NativeWebAssets,
  rasterizeUIText,
  nativeRuntime: { loadRuntime, NativeRuntimeAsset },
  createNativeFontProject: () => ({
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: 'production-font',
    name: 'Production font sample',
    assetManifest: {},
    editor: { activeArtboardId: 'board', activeRigId: null },
    artboards: [
      {
        id: 'board',
        name: 'RTL',
        width: 300,
        height: 80,
        nodes: [
          {
            id: 'label',
            name: 'Label',
            type: 'text',
            parentId: null,
            transform: sceneTransform(),
            opacity: 1,
            visible: true,
            width: 280,
            height: 80,
            text: 'سلام — Level 123',
            fontFamilies: ['Noto Sans Arabic'],
            fontSize: 28,
            lineHeight: 36,
            direction: 'rtl',
            align: 'center',
            color: 0xffffff,
          },
        ],
      },
    ],
  }),
});
