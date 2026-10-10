import { logicBindingsFixture } from './logic-bindings-fixture.mjs';
import { logicSourceFixture } from './logic-fixtures.mjs';
export function logicRoutesFixture() {
  const project = logicBindingsFixture(),
    board = project.artboards[0],
    graph = board.logic,
    legacy = logicSourceFixture(),
    rig = legacy.artboards[0].nodes[0];
  project.name = 'Typed interaction routes';
  project.assetManifest = legacy.assetManifest;
  board.nodes.push(rig);
  project.editor.activeRigId = rig.id;
  graph.parameters.push({ id: 'pressed', name: 'pressed', type: 'trigger', initial: false });
  graph.states.push({ id: 'active', name: 'Active', clip: null, loop: false });
  graph.transitions.push({
    id: 'press',
    from: 'entry',
    to: 'active',
    priority: 0,
    conditions: [{ parameterId: 'pressed', operator: 'fired' }],
    blendDuration: 0.1,
    interruption: 'higherPriority',
  });
  graph.routes = [
    { id: 'click-label', targetId: 'instance', event: 'click', parameterId: 'label', value: 'Clicked 🌿' },
    { id: 'click-trigger', targetId: 'instance', event: 'click', parameterId: 'pressed' },
    { id: 'down-alpha', targetId: null, event: 'pointerDown', parameterId: 'alpha', value: 0.25 },
    { id: 'up-alpha', targetId: null, event: 'pointerUp', parameterId: 'alpha', value: 0.75 },
    { id: 'enter-shown', targetId: 'instance', event: 'pointerEnter', parameterId: 'shown', value: false },
    { id: 'leave-shown', targetId: 'instance', event: 'pointerLeave', parameterId: 'shown', value: true },
    { id: 'focus-label', targetId: null, event: 'focus', parameterId: 'label', value: 'Focused' },
    { id: 'blur-label', targetId: null, event: 'blur', parameterId: 'label', value: 'Blurred' },
    { id: 'test-color', targetId: null, event: 'test', parameterId: 'color', value: 0xabcdef },
  ];
  rig.logic.routes = [{ id: 'rig-click', targetId: null, event: 'click', parameterId: 'rig-open' }];
  return project;
}
