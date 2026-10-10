import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { logicWorkspaceFixture } from '../../../tools/logic-workspace-fixture.mjs';

const browser = await chromium.launch({ headless: true });
const output = process.env.BBB_SHIP_EVIDENCE_DIR ?? 'packages/editor/.smoke';
mkdirSync(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }),
    errors = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const project = logicWorkspaceFixture(),
    board = project.artboards[0],
    rig = board.nodes.find((node) => node.type === 'rig');
  const mesh = rig.skeleton.attachments.find((attachment) => attachment.type === 'mesh');
  // One deliberately rigid vertex in a weighted mesh: a legal, inspectable warning.
  mesh.weights.splice(0, 5, 0);
  await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
    name: 'doctor.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page
    .locator('footer')
    .getByText(/Opened doctor.bbbproj/)
    .waitFor();
  const download = async (name) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    return readFileSync(await (await pending).path());
  };
  const original = JSON.parse((await download('Save')).toString());
  const prepare = async () => {
    await page.getByRole('button', { name: 'Ship', exact: true }).click();
    await page.getByRole('button', { name: 'Prepare native export', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="native-preview"]')?.dataset.ready === 'true',
    );
    await page.getByRole('button', { name: 'Pause native', exact: true }).click();
  };
  await prepare();
  const doctor = page.getByRole('complementary', { name: 'Ship Doctor', exact: true });
  await doctor.getByText('Runtime compatibility', { exact: true }).click();
  const rows = doctor.getByRole('row');
  assert.equal(await rows.count(), 4);
  assert.match(await rows.nth(1).textContent(), /webavailable1/);
  assert.match(await rows.nth(2).textContent(), /unitypendingPending/);
  assert.match(await rows.nth(3).textContent(), /cocospendingPending/);
  const query = doctor.getByLabel('Ship findings search', { exact: true });
  await query.fill('rig_rigid_fallback');
  assert.equal(await doctor.getByTestId('ship-finding').count(), 1);
  await doctor.getByLabel('Ship findings severity', { exact: true }).selectOption('error');
  assert.equal(await doctor.getByTestId('ship-finding').count(), 0);
  await doctor.getByLabel('Ship findings severity', { exact: true }).selectOption('warning');
  const warning = doctor.getByTestId('ship-finding');
  assert.match(await warning.textContent(), /1 of 20 vertices/);
  const native = await download('Download .bbb');
  await warning.getByRole('button', { name: 'Inspect source', exact: true }).click();
  const properties = page.getByRole('complementary', { name: 'Character properties', exact: true });
  await properties.getByText('Properties — Slot', { exact: true }).waitFor();
  assert.equal(await properties.getByLabel('Name', { exact: true }).inputValue(), rig.skeleton.slots[0].name);
  const focused = JSON.parse((await download('Save')).toString());
  assert.deepEqual(focused.artboards, original.artboards);
  assert.deepEqual(focused.assetManifest, original.assetManifest);
  assert.equal(focused.editor.activeRigId, rig.id);
  await prepare();
  const limits = page.getByText('Custom warning thresholds', { exact: true });
  await limits.click();
  await page.getByLabel('Ship limit nodes', { exact: true }).fill('0');
  await page.getByLabel('Ship limit nodes', { exact: true }).press('Tab');
  await query.fill('budget_nodes');
  await doctor
    .getByTestId('ship-finding')
    .first()
    .getByRole('button', { name: 'Inspect source', exact: true })
    .click();
  await page.getByRole('region', { name: 'Scene workspace', exact: true }).waitFor();
  assert.deepEqual(JSON.parse((await download('Save')).toString()).artboards, original.artboards);
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  await page
    .getByLabel('Open native asset', { exact: true })
    .setInputFiles({ name: 'external.bbb', mimeType: 'application/octet-stream', buffer: native });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="native-preview"]')?.dataset.ready === 'true',
  );
  assert.equal(
    await doctor.getByRole('button', { name: 'Inspect source', exact: true }).count(),
    0,
    'arbitrary native IDs cannot claim a verified link to current source',
  );
  await doctor
    .getByText('Opened native assets have no verified link to this source document.', { exact: true })
    .waitFor();
  await page.getByText('Custom warning thresholds', { exact: true }).click();
  await page.getByLabel('Ship limit textureDimension', { exact: true }).fill('0');
  await page.getByLabel('Ship limit textureDimension', { exact: true }).press('Tab');
  await query.fill('budget_texture_dimension');
  await doctor
    .getByTestId('ship-finding')
    .first()
    .getByRole('button', { name: 'Inspect atlas', exact: true })
    .click();
  assert(await page.getByLabel('Atlas inspection', { exact: true }).evaluate((details) => details.open));
  assert(await page.getByRole('img', { name: 'Atlas page 1', exact: true }).isVisible());
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'ship-doctor-ui.png') });
  writeFileSync(
    join(output, 'ship-doctor-ui.json'),
    JSON.stringify(
      {
        qualifiedMeshFocus: true,
        sourceUnchanged: true,
        searchAndSeverity: true,
        sceneFocus: true,
        pendingEngines: true,
        loadedSourceIsolation: true,
        atlasFindingFocus: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Ship/Rig Doctor search, severity, qualified slot/source focus, source preservation, honest host compatibility and external native isolation.',
  );
} finally {
  await browser.close();
}
