import { readFileSync } from 'node:fs';
import { CURRENT_SOURCE_SCHEMA } from './project-schema.mjs';
/** Reproducible native scene/rig graph source; pose adapters follow in Phase 8C. */
export function logicSourceFixture() {
  const project = JSON.parse(
    readFileSync(new URL('../fixtures/bbbproj-v1-demo.json', import.meta.url), 'utf8'),
  );
  project.schemaVersion = CURRENT_SOURCE_SCHEMA;
  project.name = 'Logic source v1';
  const board = project.artboards[0],
    rig = board.nodes[0];
  board.clips = [
    {
      id: 'logic-scene-clip',
      name: 'Reveal',
      duration: 1,
      loop: false,
      fps: 30,
      events: [],
      tracks: [
        {
          id: 'logic-scene-track',
          nodeId: rig.id,
          property: 'opacity',
          keys: [
            { id: 'logic-key-a', time: 0, value: 0.2, curve: { type: 'linear' } },
            { id: 'logic-key-b', time: 1, value: 1, curve: { type: 'linear' } },
          ],
        },
      ],
    },
  ];
  const graph = (prefix, clip) => ({
    id: `${prefix}-graph`,
    name: `${prefix} behavior`,
    enabled: true,
    entryStateId: `${prefix}-idle`,
    parameters: [
      { id: `${prefix}-open`, name: 'open', type: 'trigger', initial: false },
      { id: `${prefix}-enabled`, name: 'enabled', type: 'bool', initial: true },
      { id: `${prefix}-label`, name: 'label', type: 'string', initial: 'سلام' },
    ],
    states: [
      { id: `${prefix}-idle`, name: 'Idle', clip: null, loop: false, position: { x: 20, y: 20 } },
      { id: `${prefix}-active`, name: 'Active', clip, loop: false, position: { x: 240, y: 20 } },
    ],
    transitions: [
      {
        id: `${prefix}-start`,
        from: null,
        to: `${prefix}-active`,
        priority: 0,
        conditions: [
          { parameterId: `${prefix}-open`, operator: 'fired' },
          { parameterId: `${prefix}-enabled`, operator: 'eq', value: true },
        ],
        blendDuration: 0.1,
        interruption: 'higherPriority',
      },
    ],
  });
  board.logic = graph('scene', board.clips[0].id);
  rig.logic = graph('rig', rig.animations[0].name);
  return project;
}
