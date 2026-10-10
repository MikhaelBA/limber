import { logicWorkspaceFixture } from './logic-workspace-fixture.mjs';
export function renderGoldenFixture() {
  const project = logicWorkspaceFixture(),
    board = project.artboards[0],
    rig = board.nodes.find((node) => node.type === 'rig');
  project.assetManifest = {};
  project.components = [];
  board.width = 400;
  board.height = 300;
  delete board.logic;
  board.clips = [];
  board.nodes = [rig];
  rig.transform = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    pivotX: 0,
    pivotY: 0,
  };
  rig.animations = [
    {
      name: 'reorder',
      duration: 1,
      loop: false,
      timelines: [
        {
          kind: 'drawOrder',
          keyframes: [{ time: 0, slotOrder: [1, 0, 2, 3, 4, 5], curve: { type: 'stepped' } }],
        },
      ],
    },
  ];
  rig.logic = {
    id: 'graph',
    name: 'Render goldens',
    enabled: true,
    entryStateId: 'idle',
    parameters: [],
    states: [{ id: 'idle', name: 'Idle', clip: null, loop: false }],
    transitions: [],
  };
  const slot = (id, attachment, color = 0xffffffff) => ({
    id,
    name: id,
    boneId: 'root',
    defaultAttachmentId: attachment,
    color,
  });
  const region = (id, vertices) => ({
    id,
    name: id,
    type: 'region',
    textureId: '',
    vertices,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  });
  rig.skeleton = {
    bones: [
      {
        id: 'root',
        name: 'root',
        parentId: null,
        length: 20,
        setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
      },
    ],
    slots: [
      slot('clip-slot', 'clip'),
      slot('green-slot', 'green', 0x00ff00ff),
      slot('red-slot', 'red', 0xff000080),
      slot('second-clip-slot', 'second-clip'),
      slot('blue-slot', 'blue', 0x0000ffff),
      slot('unused-clip-slot', 'unused-clip'),
    ],
    attachments: [
      {
        id: 'clip',
        name: 'clip',
        type: 'clipping',
        textureId: '',
        meshVertices: [-100, -100, 0, -100, 0, 100, -100, 100],
        meshHull: [0, 1, 2, 3],
        endSlotId: 'red-slot',
      },
      region('green', [-80, -40, 80, -40, 80, 40, -80, 40]),
      region('red', [30, -30, 90, -30, 90, 30, 30, 30]),
      {
        id: 'second-clip',
        name: 'second clip',
        type: 'clipping',
        textureId: '',
        meshVertices: [-100, 60, 0, 60, 0, 100, -100, 100],
        meshHull: [0, 1, 2, 3],
        endSlotId: null,
      },
      region('blue', [-80, 60, 80, 60, 80, 100, -80, 100]),
      {
        id: 'unused-clip',
        name: 'unused',
        type: 'clipping',
        textureId: '',
        meshVertices: [-90, 120, 90, 120, 90, 140, -90, 140],
        meshHull: [0, 1, 2, 3],
        endSlotId: null,
      },
    ],
    skins: [],
    activeSkin: '',
    ikConstraints: [],
  };
  return project;
}
