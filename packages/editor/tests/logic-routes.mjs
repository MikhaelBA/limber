import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { logicRoutesFixture } from '../../../tools/logic-routes-fixture.mjs';
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (project, name) =>
    page
      .locator('input[type=file][accept^=".bbbproj"]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const project = logicRoutesFixture();
  await open(project, 'routes.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened routes.bbbproj/)
    .waitFor();
  const saved = await save();
  assert.deepEqual(saved, project);
  const results = await page.evaluate(
    async ({ project, moduleUrl }) => {
      const { SceneLogicPlayer, RigLogicPlayer } = await import(moduleUrl),
        before = JSON.stringify(project);
      const scene = new SceneLogicPlayer(project.artboards[0], project.components);
      for (const [event, target] of [
        ['focus', null],
        ['pointerDown', null],
        ['pointerUp', null],
        ['pointerEnter', 'instance'],
        ['pointerLeave', 'instance'],
        ['click', 'instance'],
        ['blur', null],
        ['test', null],
      ])
        scene.dispatch(event, target);
      scene.update(1 / 120);
      const trace = scene.inputRouter.recentDispatches();
      const parity = [];
      for (const fps of [10, 60, 120, 144, 240, 1000]) {
        const a = new SceneLogicPlayer(project.artboards[0], project.components),
          b = new RigLogicPlayer(project.artboards[0].nodes.find((n) => n.type === 'rig'));
        a.dispatch('click', 'instance');
        b.dispatch('click');
        for (let i = 0; i < fps; i++) {
          a.update(1 / fps);
          b.update(1 / fps);
        }
        parity.push({
          scene: a.snapshot(),
          view: a.getView(),
          rig: b.snapshot(),
          matrices: Array.from(b.getWorldTransforms()),
          trace: a.inputRouter.recentDispatches(),
        });
      }
      return {
        trace,
        snapshot: scene.snapshot(),
        parity,
        sourcePreserved: before === JSON.stringify(project),
      };
    },
    { project: saved, moduleUrl: `/@fs/${resolve('packages/core/src/index.ts').replaceAll('\\', '/')}` },
  );
  assert.equal(results.sourcePreserved, true);
  assert.equal(results.trace.length, 8);
  assert.equal(results.trace[5].inputs.length, 2);
  assert.equal(results.snapshot.stateId, 'active');
  assert.equal(results.snapshot.parameters.label, 'Blurred');
  assert.equal(results.snapshot.parameters.color, 0xabcdef);
  for (const value of results.parity) assert.deepEqual(value, results.parity[0]);
  for (const [index, mutate] of [
    (p) => {
      p.artboards[0].logic.routes[0].targetId = 'missing';
    },
    (p) => {
      p.artboards[0].logic.routes[2].value = 2;
    },
    (p) => {
      p.artboards[0].nodes.find((n) => n.type === 'rig').logic.routes[0].targetId = 'instance';
    },
    (p) => {
      p.artboards[0].logic.routes[1].value = false;
    },
  ].entries()) {
    const bad = structuredClone(saved);
    mutate(bad);
    await open(bad, `bad-route-${index}.bbbproj`);
    await page
      .locator('footer')
      .getByText(/Open failed:/)
      .waitFor();
    assert.deepEqual(await save(), saved);
  }
  await open(saved, 'routes-reopened.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened routes-reopened.bbbproj/)
    .waitFor();
  assert.deepEqual(await save(), saved);
  writeFileSync('packages/editor/.smoke/routes.bbbproj', JSON.stringify(saved, null, 2));
  writeFileSync('packages/editor/.smoke/logic-routes.json', JSON.stringify(results, null, 2));
  assert.deepEqual(errors, []);
  console.log(
    'PASS: typed pointer/focus/test routes, authored-order atomic batches, source preservation, scene/rig replay parity across six frame groupings, native round trips and invalid-import isolation; preview UI follows separately',
  );
} finally {
  await browser.close();
}
