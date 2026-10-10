import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { logicWorkspaceFixture } from '../../../tools/logic-workspace-fixture.mjs';
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (project, name) => {
    await page
      .locator('input[type=file][accept^=".bbbproj"]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.locator('footer').getByText(`Opened ${name}`, { exact: false }).waitFor();
  };
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const project = logicWorkspaceFixture();
  await open(project, 'interactive.bbbproj');
  await page.getByRole('button', { name: 'Logic', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Logic workspace' }),
    preview = page.getByTestId('logic-preview'),
    canvas = preview.locator('canvas');
  await canvas.waitFor();
  await page.getByTestId('logic-tick').filter({ hasText: '0' }).waitFor();
  assert.deepEqual(await save(), project);
  await workspace.getByLabel('Test label', { exact: true }).fill('پاداش ۱۲۳ 🌿');
  await workspace.getByLabel('Test label', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  assert.equal(await page.getByTestId('logic-tick').textContent(), '1');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="logic-preview"]').dataset.tick === '1',
  );
  const textView = await page.evaluate(() => window.__logicCapture().view.filter((n) => n.type === 'text'));
  assert.equal(textView.length, 2);
  assert.ok(textView.every((n) => n.renderedText === 'پاداش ۱۲۳ 🌿'));
  const rasters = Number(await preview.getAttribute('data-text-rasters')),
    rebuilds = await preview.getAttribute('data-rebuilds');
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  assert.equal(Number(await preview.getAttribute('data-text-rasters')), rasters);
  assert.equal(await preview.getAttribute('data-rebuilds'), rebuilds);
  for (const shown of [false, true]) {
    await workspace.getByLabel('Test shown', { exact: true }).selectOption(String(shown));
    await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
    await page.waitForFunction(
      (shown) =>
        window.__logicCapture().view.find((n) => n.type === 'text' && n.id !== 'direct').visible === shown,
      shown,
    );
    assert.equal(await preview.getAttribute('data-rebuilds'), rebuilds);
    assert.equal(Number(await preview.getAttribute('data-text-rasters')), rasters);
  }
  await workspace.getByLabel('Test alpha', { exact: true }).fill('1.1');
  await workspace.getByLabel('Test alpha', { exact: true }).press('Tab');
  await workspace
    .getByRole('alert')
    .getByText(/\[0,1\]/)
    .waitFor();
  assert.deepEqual(await save(), project);
  await page.getByRole('button', { name: 'Reset Logic', exact: true }).click();
  await canvas.focus();
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  assert.equal(await workspace.getByLabel('Test focused', { exact: true }).inputValue(), 'false');
  const rect = await canvas.boundingBox();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  await page.getByTestId('logic-state').filter({ hasText: 'Reveal' }).waitFor();
  assert.equal(await workspace.getByLabel('Test label', { exact: true }).inputValue(), 'Clicked 🌿');
  await workspace
    .getByRole('complementary', { name: 'Logic debug history' })
    .getByText(/UIConfirm.*bool:\s*true/)
    .waitFor();
  await page.getByRole('button', { name: 'Play Logic', exact: true }).click();
  await page.waitForFunction(
    () => Number(document.querySelector('[data-testid="logic-preview"]').dataset.tick) > 12,
  );
  await page.getByRole('button', { name: 'Pause Logic', exact: true }).click();
  const held = await page.getByTestId('logic-tick').textContent();
  await page.waitForTimeout(150);
  assert.equal(await page.getByTestId('logic-tick').textContent(), held);
  assert.equal(await preview.getAttribute('data-rebuilds'), rebuilds);
  const enabled = workspace.getByLabel('Test Logic enabled');
  await enabled.uncheck();
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  assert.equal(await page.getByTestId('logic-tick').textContent(), held);
  await enabled.check();
  assert.equal(await page.getByTestId('logic-tick').textContent(), held);
  assert.deepEqual(await save(), project);
  await page.screenshot({ path: 'packages/editor/.smoke/logic-workspace-scene.png' });
  const inspector = workspace.getByRole('complementary', { name: 'Logic inspector' });
  await inspector.getByRole('button', { name: 'label', exact: true }).click();
  await inspector.getByLabel('Parameter name', { exact: true }).fill('caption');
  await inspector.getByLabel('Parameter name', { exact: true }).press('Tab');
  const renamed = await save();
  assert.equal(renamed.artboards[0].logic.parameters[0].name, 'caption');
  assert.equal(renamed.artboards[0].nodes.find((n) => n.id === 'direct').binding, 'caption');
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await save(), project);
  await workspace.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await save(), renamed);
  const stateCard = workspace.getByRole('button', { name: 'State Idle', exact: true }),
    box = await stateCard.boundingBox();
  await page.mouse.move(box.x + 35, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 40, { steps: 4 });
  await page.mouse.up();
  const moved = await save();
  assert.deepEqual(moved.artboards[0].logic.states[0].position, { x: 90, y: 120 });
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await save(), renamed);
  await workspace.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await save(), moved);
  const again = await stateCard.boundingBox();
  await page.mouse.move(again.x + 35, again.y + 20);
  await page.mouse.down();
  await page.mouse.move(again.x + 55, again.y + 35, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await save(), moved);
  await inspector.getByRole('button', { name: 'Add parameter', exact: true }).click();
  await inspector.getByLabel('Parameter type', { exact: true }).selectOption('trigger');
  await inspector.getByLabel('Parameter name', { exact: true }).fill('celebrate');
  await inspector.getByLabel('Parameter name', { exact: true }).press('Tab');
  await inspector.getByRole('button', { name: 'Add input route', exact: true }).click();
  await inspector.getByLabel('Input parameter', { exact: true }).selectOption({ label: 'celebrate' });
  await inspector.getByLabel('Input event', { exact: true }).selectOption('click');
  const authored = await save();
  assert.ok(
    authored.artboards[0].logic.routes.some(
      (r) =>
        r.event === 'click' &&
        r.parameterId === authored.artboards[0].logic.parameters.find((p) => p.name === 'celebrate').id &&
        !Object.hasOwn(r, 'value'),
    ),
  );
  await inspector.getByRole('button', { name: 'Add state', exact: true }).click();
  await inspector.getByLabel('State name', { exact: true }).fill('Celebrate');
  await inspector.getByLabel('State name', { exact: true }).press('Tab');
  await inspector.getByLabel('State clip', { exact: true }).selectOption('reveal');
  await inspector.getByRole('button', { name: 'Add transition', exact: true }).click();
  await inspector.getByLabel('Transition from', { exact: true }).selectOption('');
  await inspector.getByLabel('Transition to', { exact: true }).selectOption({ label: 'Celebrate' });
  await inspector.getByLabel('Condition 1 parameter', { exact: true }).selectOption({ label: 'celebrate' });
  await inspector.getByLabel('Blend seconds', { exact: true }).fill('0.25');
  await inspector.getByLabel('Blend seconds', { exact: true }).press('Tab');
  await inspector.getByLabel('Transition priority', { exact: true }).fill('1');
  await inspector.getByLabel('Transition priority', { exact: true }).press('Tab');
  const withEdge = await save(),
    edge = withEdge.artboards[0].logic.transitions.find((t) => t.id !== 'press');
  assert.equal(edge.from, null);
  assert.equal(edge.blendDuration, 0.25);
  assert.equal(edge.conditions[0].operator, 'fired');
  await inspector.getByLabel('Exit time (0–1, blank for none)', { exact: true }).fill('0.5');
  await inspector.getByLabel('Exit time (0–1, blank for none)', { exact: true }).press('Tab');
  await workspace.getByRole('alert').waitFor();
  assert.deepEqual(await save(), withEdge);
  await page.getByRole('button', { name: 'Reset Logic', exact: true }).click();
  await page.getByRole('button', { name: 'Fire celebrate', exact: true }).click();
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  await page.getByTestId('logic-state').filter({ hasText: 'Celebrate' }).waitFor();
  await inspector.getByRole('button', { name: 'text ← caption', exact: true }).click();
  await inspector.getByRole('button', { name: 'Delete binding', exact: true }).click();
  await inspector.getByRole('button', { name: 'Add binding', exact: true }).click();
  assert.equal(await inspector.getByLabel('Binding parameter', { exact: true }).inputValue(), 'label');
  const complete = await save();
  assert.equal(complete.artboards[0].logic.bindings.length, 4);
  await workspace.getByLabel('Logic owner').selectOption(project.editor.activeRigId);
  await page.getByRole('button', { name: 'Send click to viewport', exact: true }).click();
  await page.getByRole('button', { name: 'Step Logic', exact: true }).click();
  await page.getByTestId('logic-state').filter({ hasText: 'Active' }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="logic-preview"]').dataset.tick === '1',
  );
  const posing = await page.evaluate(
    async ({ source, moduleUrl }) => {
      const { RigLogicPlayer } = await import(moduleUrl),
        rig = source.artboards[0].nodes.find((n) => n.type === 'rig'),
        player = new RigLogicPlayer(rig);
      player.pause();
      player.dispatch('click');
      player.step();
      return {
        actual: window.__logicCapture().rigs.find((r) => r.id === rig.id),
        expected: {
          matrices: Array.from(player.getWorldTransforms()),
          vertices: Object.fromEntries(
            [...player.skeleton.pose.attachments].map(([id, state]) => [id, Array.from(state.verts)]),
          ),
        },
      };
    },
    { source: complete, moduleUrl: `/@fs/${resolve('packages/core/src/index.ts').replaceAll('\\', '/')}` },
  );
  assert.deepEqual(posing.actual.matrices, posing.expected.matrices);
  assert.ok(posing.actual.meshes.length > 0);
  for (const mesh of posing.actual.meshes)
    assert.deepEqual(mesh.positions, posing.expected.vertices[mesh.attachmentId]);
  assert.deepEqual(await save(), complete);
  await page.screenshot({ path: 'packages/editor/.smoke/logic-workspace-character.png' });
  await page.getByRole('button', { name: 'Character', exact: true }).click();
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.deepEqual(
    (await save()).artboards[0].nodes.find((n) => n.type === 'rig').animations,
    complete.artboards[0].nodes.find((n) => n.type === 'rig').animations,
  );
  await open(complete, 'interactive-reopened.bbbproj');
  assert.deepEqual(await save(), complete);
  await page.getByRole('button', { name: 'Logic', exact: true }).click();
  await page.getByTestId('logic-preview').locator('canvas').waitFor();
  await workspace
    .getByRole('complementary', { name: 'Logic inspector' })
    .getByRole('button', { name: 'Remove graph', exact: true })
    .click();
  assert.equal((await save()).artboards[0].logic, undefined);
  await page.getByRole('button', { name: 'Create Logic graph', exact: true }).click();
  const recreated = await save();
  assert.equal(recreated.artboards[0].logic.states.length, 1);
  assert.equal(recreated.artboards[0].logic.parameters[0].name, 'caption');
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Create Logic graph', exact: true }).waitFor();
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await save(), complete);
  writeFileSync('packages/editor/.smoke/logic-workspace.bbbproj', JSON.stringify(complete, null, 2));
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Scene/Character Logic workspace, typed/invalid test inputs, physical pointer/focus, events, pause/disable, cached text/geometry, parameter/route authoring, single-undo graph drag, native Save/Open and raw clip/source preservation',
  );
} finally {
  await browser.close();
}
