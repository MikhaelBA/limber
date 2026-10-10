import { CURRENT_SOURCE_SCHEMA } from './project-schema.mjs';
export function logicBindingsFixture() {
  const base = (id) => ({
    id,
    name: id,
    parentId: null,
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, pivotX: 0, pivotY: 0 },
    opacity: 1,
    visible: true,
  });
  const text = (id) => ({
    ...base(id),
    type: 'text',
    width: 280,
    height: 80,
    text: 'متن ذخیره‌شده',
    fontFamilies: ['sans-serif'],
    fontSize: 24,
    lineHeight: 30,
    direction: 'rtl',
    align: 'start',
    color: 0xffffff,
  });
  const properties = ['text', 'visible', 'opacity', 'tint'];
  return {
    format: 'bonebybone-project',
    schemaVersion: CURRENT_SOURCE_SCHEMA,
    projectId: 'binding-demo',
    name: 'Logic bindings',
    assetManifest: {},
    editor: { activeArtboardId: 'board', activeRigId: null },
    components: [
      {
        id: 'button',
        name: 'Button',
        revision: 1,
        width: 280,
        height: 80,
        nodes: [text('label')],
        exposed: properties.map((property) => ({ name: property, nodeId: 'label', property })),
      },
    ],
    artboards: [
      {
        id: 'board',
        name: 'Bindings',
        width: 640,
        height: 480,
        nodes: [
          {
            ...base('instance'),
            type: 'instance',
            componentId: 'button',
            width: 280,
            height: 80,
            overrides: {},
          },
          { ...text('direct'), binding: 'label', transform: { ...base('direct').transform, y: 100 } },
        ],
        logic: {
          id: 'graph',
          name: 'UI behavior',
          enabled: true,
          entryStateId: 'entry',
          states: [{ id: 'entry', name: 'Setup', clip: null, loop: false }],
          transitions: [],
          parameters: [
            { id: 'label', name: 'label', type: 'string', initial: 'سلام 🌿' },
            { id: 'shown', name: 'shown', type: 'bool', initial: true },
            { id: 'alpha', name: 'alpha', type: 'float', initial: 0.5 },
            { id: 'color', name: 'color', type: 'int', initial: 0x123456 },
          ],
          bindings: properties.map((property, i) => ({
            id: `binding-${i}`,
            parameterId: ['label', 'shown', 'alpha', 'color'][i],
            instanceId: 'instance',
            exposureName: property,
            property,
          })),
        },
      },
    ],
  };
}
