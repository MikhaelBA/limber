import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const evidence = resolve(process.env.BBB_WEIGHT_EVIDENCE_DIR ?? 'packages/editor/.smoke/weight-workflow');
mkdirSync(evidence, { recursive: true });
const original = JSON.parse(readFileSync('examples/face-weights/Face-Weights.bbbproj', 'utf8'));
const meshOf = (project) => project.artboards[0].nodes[0].skeleton.attachments[0];
const rowsOf = (mesh) => {
  const rows = [];
  let p = 0;
  while (p < mesh.weights.length) {
    const n = mesh.weights[p++],
      row = [];
    for (let k = 0; k < n; k++) row.push({ bone: mesh.weights[p++], weight: mesh.weights[p++] });
    rows.push(row);
  }
  return rows;
};
const sourceMesh = meshOf(original),
  originalRows = rowsOf(sourceMesh),
  jaw = original.artboards[0].nodes[0].skeleton.bones.findIndex((b) => b.id === 'jaw');
const vertices = originalRows
  .map((row, i) => (row.some((item) => item.bone === jaw && item.weight > 0.1 && item.weight < 0.8) ? i : -1))
  .filter((i) => i >= 0);
const [a, b] = [vertices[0], vertices.at(-1)];
assert.notEqual(a, b);
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
    errors = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /shader|WebGL|program/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (project) => {
    await page.locator('input[type=file]').setInputFiles({
      name: 'workflow.bbbproj',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page
      .locator('footer')
      .getByText(/Opened workflow.bbbproj/)
      .waitFor();
  };
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const screen = (vertex) =>
    page.evaluate(
      ([x, y]) => window.__worldToScreen(x, y),
      sourceMesh.meshVertices.slice(vertex * 2, vertex * 2 + 2),
    );
  const clickVertex = async (vertex) => {
    await page.mouse.click(...(await screen(vertex)));
  };
  await open(original);
  await page
    .getByText(/^Face mesh — paint here/)
    .first()
    .click();
  await page.getByRole('button', { name: '⚖ Weights', exact: true }).click();
  await page.getByLabel('Weight brush behavior', { exact: true }).selectOption('direct');
  await page.getByRole('button', { name: 'Weight bone Jaw', exact: true }).click();
  await clickVertex(a);
  await page.getByText('1 vertices selected', { exact: false }).waitFor();
  await page.getByLabel('Direct weight percent').fill('70');
  await page.getByRole('button', { name: 'Set selected weights', exact: true }).click();
  const edited = await save(),
    rows = rowsOf(meshOf(edited));
  assert.equal(rows[a].find((i) => i.bone === jaw).weight, 0.7);
  const expected = structuredClone(original);
  meshOf(expected).weights = meshOf(edited).weights;
  assert.deepEqual(edited, expected);
  rows.forEach((row, v) => {
    if (v !== a) assert.deepEqual(row, originalRows[v]);
  });
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), edited);
  // Copy/paste a real selected vertex; clipboard stores bone IDs, not stale indices.
  await page.getByRole('button', { name: 'Copy weights', exact: true }).click();
  await clickVertex(b);
  await page.getByRole('button', { name: 'Paste weights', exact: true }).click();
  assert.deepEqual(rowsOf(meshOf(await save()))[b], rows[a]);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), edited);
  await page.getByRole('button', { name: '✥ Translate', exact: true }).click();
  await page.getByRole('button', { name: '⚖ Weights', exact: true }).click();
  await page.getByText('1 vertices selected', { exact: false }).waitFor();
  // A lock keeps the exact selected vertex budget during a different bone's Direct edit.
  await page.getByLabel('Lock Head / rigid base weights', { exact: true }).check();
  const locked = await save();
  await page.getByLabel('Direct weight percent').fill('95');
  await page.getByRole('button', { name: 'Set selected weights', exact: true }).click();
  const lockedRows = rowsOf(meshOf(await save())),
    beforeLocked = rowsOf(meshOf(locked));
  const head = original.artboards[0].nodes[0].skeleton.bones.findIndex((bone) => bone.id === 'head');
  assert.equal(
    lockedRows[b].find((i) => i.bone === head)?.weight,
    beforeLocked[b].find((i) => i.bone === head)?.weight,
  );
  await page.getByLabel('Lock Head / rigid base weights', { exact: true }).uncheck();
  await open(original);
  await page
    .getByText(/^Face mesh — paint here/)
    .first()
    .click();
  await page.getByRole('button', { name: '⚖ Weights', exact: true }).click();
  await page.getByLabel('Weight brush behavior', { exact: true }).selectOption('direct');
  await page.getByRole('button', { name: 'Weight bone Jaw', exact: true }).click();
  await clickVertex(a);
  const [x, y] = await screen(a);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 5 });
  await page.mouse.up();
  assert.notDeepEqual(await save(), original);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original, 'Direct drag is one history step');
  await page.getByRole('button', { name: 'Auto weights', exact: true }).click();
  await page
    .locator('footer')
    .getByText(/Auto weights applied/)
    .waitFor();
  const autoSelected = rowsOf(meshOf(await save()));
  assert.deepEqual(autoSelected[a], [{ bone: jaw, weight: 1 }], 'Auto uses only the selected bone group');
  autoSelected.forEach((row, vertex) => {
    if (vertex !== a) assert.deepEqual(row, originalRows[vertex], 'Auto preserves unselected vertices');
  });
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original);
  await page.getByLabel('Weight overlay', { exact: true }).check();
  await page.getByLabel('Weight selectedOnly', { exact: true }).check();
  const canvas = page.locator('canvas').first(),
    beforePreview = await canvas.screenshot();
  await page.getByRole('button', { name: 'Clear vertices', exact: true }).click();
  await page.getByLabel('Maximum mesh influences').fill('1');
  await page.getByText('Prune preview', { exact: true }).click();
  await page
    .getByLabel('Prune preview', { exact: true })
    .getByText(/would be removed/)
    .waitFor();
  await page.waitForTimeout(100);
  assert.deepEqual(await save(), original, 'Live prune preview never changes saved weights');
  assert.equal(
    beforePreview.equals(await canvas.screenshot()),
    false,
    'Actual GPU overlay responds to preview',
  );
  await page.getByText('Prune preview', { exact: true }).click();
  await page.getByLabel('Weight overlay', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all vertices', exact: true }).click();
  await page.getByLabel('Direct weight percent').fill('65');
  await page.getByRole('button', { name: 'Set selected weights', exact: true }).click();
  await page.getByTitle('Play/Pause (Space)', { exact: true }).click();
  const playingEdit = await save();
  assert.notDeepEqual(meshOf(playingEdit).weights, sourceMesh.weights);
  assert.deepEqual(playingEdit.artboards[0].nodes[0].animations, original.artboards[0].nodes[0].animations);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original);
  // The practical sample has four independently recognizable rendered performances.
  const performance = JSON.parse(readFileSync('examples/face-performance/Face-Performance.bbbproj', 'utf8'));
  await open(performance);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  const animation = page.locator('select').filter({ has: page.locator('option', { hasText: /^Talking$/ }) }),
    images = [];
  for (const [name, time] of [
    ['Talking', 0.4],
    ['Crying', 2.5],
    ['Head Tilt', 0.9],
    ['Laughing', 1.2],
  ]) {
    await animation.selectOption(name);
    await page
      .locator('.cursor-ew-resize')
      .first()
      .click({ position: { x: time * 100, y: 12 } });
    await page.waitForTimeout(100);
    images.push(await canvas.screenshot({ path: join(evidence, name.replaceAll(' ', '-') + '.png') }));
  }
  for (let i = 0; i < images.length; i++)
    for (let j = i + 1; j < images.length; j++) assert.equal(images[i].equals(images[j]), false);
  assert.deepEqual(await save(), performance);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(evidence, 'workflow-result.json'),
    JSON.stringify(
      {
        Direct: 'passed',
        proportionalLocks: 'passed',
        copyPaste: 'passed',
        retainedSelection: 'passed',
        GPUOverlay: 'passed',
        livePrunePreview: 'passed',
        animatedEditing: 'passed',
        fourFacialPerformances: 'passed',
        errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: precise Direct editing and drag/history, locks, copy/paste, retained selection, live GPU prune preview, playback editing and four practical facial clips',
  );
} finally {
  await browser.close();
}
