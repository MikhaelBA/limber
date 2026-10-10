import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { logicSourceFixture } from '../../../tools/logic-fixtures.mjs';
import { CURRENT_SOURCE_SCHEMA } from '../../../tools/project-schema.mjs';
mkdirSync('packages/editor/.smoke', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (project, name) =>
    page
      .locator('input[type=file]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const project = logicSourceFixture();
  await open(project, 'logic-source.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened logic-source.bbbproj/)
    .waitFor();
  const saved = await save();
  assert.equal(saved.schemaVersion, CURRENT_SOURCE_SCHEMA);
  assert.deepEqual(saved, project);
  for (const name of ['Export Spine JSON', 'Export Spine Bundle']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page
      .locator('footer')
      .getByText(/export failed:.*Native Logic/)
      .waitFor();
    assert.deepEqual(await save(), saved);
  }
  const invalids = [
    (p) => {
      p.artboards[0].logic.entryStateId = 'missing';
    },
    (p) => {
      p.artboards[0].nodes[0].logic.states[1].clip = 'missing';
    },
    (p) => {
      p.artboards[0].logic.transitions[0].conditions[1].value = 'wrong type';
    },
    (p) => {
      p.artboards[0].nodes[0].logic.parameters[0].initial = true;
    },
  ];
  for (let n = 0; n < invalids.length; n++) {
    const bad = structuredClone(saved);
    invalids[n](bad);
    await open(bad, `invalid-logic-${n}.bbbproj`);
    await page
      .locator('footer')
      .getByText(/Open failed:/)
      .waitFor();
    assert.deepEqual(await save(), saved);
  }
  await open(saved, 'reopened-logic.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened reopened-logic.bbbproj/)
    .waitFor();
  assert.deepEqual(await save(), saved);
  writeFileSync('packages/editor/.smoke/logic-source.bbbproj', JSON.stringify(saved, null, 2));
  await page.screenshot({ path: 'packages/editor/.smoke/logic-source.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: native scene/rig Logic graphs, exact Save/Open, typed/clip/entry import rejection and explicit compatibility-export failure; playback/UI integration remains separate',
  );
} finally {
  await browser.close();
}
