import {
  PROJECT_SCHEMA_VERSION,
  sceneTransform,
  type BoneByBoneProject,
  type TextNode,
  type UIComponent,
} from '../src';
export const uiBase = (id: string) => ({
  id,
  name: id,
  parentId: null,
  transform: sceneTransform(),
  opacity: 1,
  visible: true,
});
export const uiText = (id = 'label'): TextNode => ({
  ...uiBase(id),
  type: 'text',
  width: 240,
  height: 40,
  text: 'پاداش ۱۲۳',
  fontFamilies: ['sans-serif'],
  fontSize: 24,
  lineHeight: 30,
  direction: 'rtl',
  align: 'start',
  color: 0xffffff,
});
export function uiFixture(): BoneByBoneProject {
  const component: UIComponent = {
    id: 'button',
    name: 'Button',
    revision: 1,
    width: 240,
    height: 64,
    nodes: [uiText()],
    exposed: [{ name: 'label', nodeId: 'label', property: 'text' }],
  };
  return {
    format: 'bonebybone-project',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: 'project',
    name: 'UI test',
    artboards: [
      {
        id: 'ui',
        name: 'UI',
        width: 390,
        height: 844,
        nodes: [
          {
            ...uiBase('instance'),
            type: 'instance',
            componentId: 'button',
            width: 240,
            height: 64,
            overrides: { label: 'Claim 123' },
          },
        ],
      },
    ],
    components: [component],
    assetManifest: {},
    editor: { activeArtboardId: 'ui', activeRigId: null },
  };
}
