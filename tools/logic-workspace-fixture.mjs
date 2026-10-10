import { logicRoutesFixture } from './logic-routes-fixture.mjs';
export function logicWorkspaceFixture() {
  const p = logicRoutesFixture(),
    board = p.artboards[0],
    graph = board.logic,
    rig = board.nodes.find((n) => n.type === 'rig');
  p.name = 'Interactive UI and character';
  graph.parameters.find((p) => p.id === 'alpha').initial = 1;
  graph.parameters.find((p) => p.id === 'color').initial = 0xffffff;
  graph.parameters.push({ id: 'focused', name: 'focused', type: 'bool', initial: false });
  graph.states[0].name = 'Idle';
  graph.states[1].name = 'Reveal';
  graph.states[1].clip = 'reveal';
  graph.routes = graph.routes.filter(
    (r) => !['pointerEnter', 'pointerLeave', 'focus', 'blur'].includes(r.event),
  );
  graph.routes.push(
    ...['focus', 'blur', 'pointerEnter', 'pointerLeave'].map((event) => ({
      id: `route-${event}`,
      targetId: event.startsWith('pointer') ? 'instance' : null,
      event,
      parameterId: 'focused',
      value: event === 'focus' || event === 'pointerEnter',
    })),
  );
  board.clips = [
    {
      id: 'reveal',
      name: 'Reveal motion',
      duration: 1,
      loop: false,
      fps: 30,
      tracks: [
        {
          id: 'slide',
          nodeId: 'direct',
          property: 'x',
          keys: [
            { id: 'slide-a', time: 0, value: 0, curve: { type: 'linear' } },
            { id: 'slide-b', time: 1, value: 100, curve: { type: 'linear' } },
          ],
        },
      ],
      events: [{ id: 'confirm', time: 0, name: 'UIConfirm', payload: { type: 'bool', value: true } }],
    },
  ];
  p.components[0].nodes.unshift({
    id: 'background',
    name: 'Button background',
    type: 'shape',
    parentId: null,
    transform: { ...board.nodes[0].transform },
    opacity: 1,
    visible: true,
    width: 280,
    height: 80,
    color: 0x334155,
    radius: 10,
  });
  rig.transform = { ...rig.transform, x: 210, y: -120, scaleX: 0.6, scaleY: 0.6 };
  return p;
}
