import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  await page.getByRole('button', { name: 'Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Add artboard', exact: true }).click();
  const image = async (name, color) => {
    await page.getByLabel('Import scene image', { exact: true }).setInputFiles({
      name,
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${color}"/></svg>`,
      ),
    });
    await page.getByRole('button', { name: `${name} image`, exact: true }).waitFor();
  };
  const setNumber = async (label, value) => {
    const input = page.getByRole('spinbutton', { name: label, exact: true });
    await input.fill(String(value));
    await input.press('Tab');
  };
  const select = async (name) => page.getByRole('button', { name: `${name} image`, exact: true }).click();
  await image('A.svg', '#f7c85b');
  await setNumber('Node x', -100);
  await image('B.svg', '#39d7c1');
  await setNumber('Node x', 100);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.getByRole('button', { name: 'New clip', exact: true }).click();
  await select('A.svg');
  await page.getByRole('button', { name: 'Key property', exact: true }).click();
  await select('B.svg');
  await page.getByRole('combobox', { name: 'Scene key property' }).selectOption('opacity');
  await page.getByRole('button', { name: 'Key property', exact: true }).click();
  await setNumber('Scene time', 1);
  await page.getByRole('checkbox', { name: 'Auto-key', exact: true }).check();
  await select('A.svg');
  await setNumber('Node x', 100);
  await select('B.svg');
  await setNumber('Node opacity', 0.2);
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  let project = await save(),
    board = project.artboards[1],
    clip = board.clips[0];
  assert.equal(project.schemaVersion, 4);
  assert.equal(clip.tracks.length, 2);
  assert.equal(clip.tracks[0].keys.length, 2);
  assert.equal(clip.tracks[1].keys.length, 2);
  assert.equal(
    board.nodes.find((node) => node.name === 'A.svg').transform.x,
    -100,
    'Animation must not overwrite setup',
  );
  assert.equal(board.nodes.find((node) => node.name === 'B.svg').opacity, 1);
  await setNumber('Scene time', 0.5);
  assert.ok(
    Math.abs(
      Number(await page.getByRole('spinbutton', { name: 'Node opacity', exact: true }).inputValue()) - 0.6,
    ) < 1e-6,
  );
  await select('A.svg');
  assert.ok(
    Math.abs(Number(await page.getByRole('spinbutton', { name: 'Node x', exact: true }).inputValue())) < 1e-6,
  );
  await page.getByRole('checkbox', { name: 'Auto-key', exact: true }).uncheck();
  await setNumber('Node x', 40);
  assert.deepEqual((await save()).artboards, project.artboards, 'Unkeyed preview is never persisted');
  await setNumber('Scene time', 0.25);
  await setNumber('Scene time', 0.5);
  assert.ok(
    Math.abs(Number(await page.getByRole('spinbutton', { name: 'Node x', exact: true }).inputValue())) < 1e-6,
    'Scrub clears unkeyed preview',
  );
  const key = page.locator(`[data-key-id="${clip.tracks[0].keys[0].id}"]`);
  await key.click();
  await page.getByRole('combobox', { name: 'Scene key curve', exact: true }).selectOption('bezier');
  await setNumber('Scene time', 0.25);
  assert.ok(
    Math.abs(
      Number(await page.getByRole('spinbutton', { name: 'Node x', exact: true }).inputValue()) - -74.16762,
    ) < 0.01,
  );
  await page.getByRole('textbox', { name: 'Scene event name' }).fill('claim-ready');
  await page.getByRole('button', { name: 'Key event', exact: true }).click();
  await page.getByRole('button', { name: 'Stop scene', exact: true }).click();
  await page.getByRole('button', { name: 'Play scene', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Scene events"]')?.textContent?.includes('claim-ready'),
  );
  await page.getByRole('button', { name: 'Pause scene', exact: true }).click();
  project = await save();
  clip = project.artboards[1].clips[0];
  await setNumber('Scene time', 0.25);
  const expected = await page.getByRole('spinbutton', { name: 'Node x', exact: true }).inputValue();
  await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
    name: 'motion.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByText(/Opened motion.bbbproj/).waitFor();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.getByRole('combobox', { name: 'Scene clip', exact: true }).selectOption(clip.id);
  await select('A.svg');
  await setNumber('Scene time', 0.25);
  assert.equal(await page.getByRole('spinbutton', { name: 'Node x', exact: true }).inputValue(), expected);
  assert.deepEqual((await save()).artboards, project.artboards);
  const scene = page.getByRole('region', { name: 'Scene workspace' });
  const keyButton = (id) => page.locator(`[data-key-id="${id}"]`);
  const firstEnd = clip.tracks[0].keys[1].id,
    secondEnd = clip.tracks[1].keys[1].id;
  await keyButton(firstEnd).click();
  await keyButton(secondEnd).click({ modifiers: ['Shift'] });
  const areaBounds = await page.getByTestId('scene-keys').boundingBox();
  const endBounds = await keyButton(firstEnd).boundingBox();
  await page.mouse.move(endBounds.x - 3, areaBounds.y + 1);
  await page.mouse.down();
  await page.mouse.move(endBounds.x + endBounds.width + 3, areaBounds.y + 55, { steps: 8 });
  await page.mouse.up();
  await page.getByText('2 selected keys', { exact: true }).waitFor();
  const marker = await keyButton(firstEnd).boundingBox();
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  await page.mouse.move(marker.x + marker.width / 2 + 90, marker.y + marker.height / 2, { steps: 12 });
  await page.mouse.up();
  let changed = await save();
  assert.deepEqual(
    changed.artboards[1].clips[0].tracks.map((track) => track.keys[1].time),
    [1.5, 1.5],
  );
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual((await save()).artboards, project.artboards, 'One undo restores a multi-key drag');
  await page.getByRole('button', { name: 'Duplicate keys', exact: true }).click();
  assert.deepEqual(
    (await save()).artboards[1].clips[0].tracks.map((track) => track.keys.length),
    [3, 3],
  );
  await page.getByRole('button', { name: 'Delete keys', exact: true }).click();
  assert.deepEqual((await save()).artboards, project.artboards);
  await keyButton(clip.tracks[0].keys[0].id).click();
  await keyButton(firstEnd).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Time ×0.5', exact: true }).click();
  assert.equal((await save()).artboards[1].clips[0].tracks[0].keys[1].time, 0.5);
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  await keyButton(firstEnd).click();
  const again = await keyButton(firstEnd).boundingBox();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + again.width / 2 + 36, again.y + again.height / 2, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual((await save()).artboards, project.artboards, 'Escape cancels a timeline key drag');
  await keyButton(clip.tracks[0].keys[0].id).click();
  const handle = await page.getByLabel('Bezier handle 1', { exact: true }).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 16, handle.y + handle.height / 2 - 8, { steps: 8 });
  await page.mouse.up();
  changed = await save();
  assert.ok(changed.artboards[1].clips[0].tracks[0].keys[0].curve.c1 > 0.42);
  await scene.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual((await save()).artboards, project.artboards, 'Curve handle commits one undo entry');
  await page.screenshot({ path: 'packages/editor/.smoke/scene-motion.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: two-image scene motion, explicit/auto key, setup isolation, curve graph, events, native save/reopen parity',
  );
} finally {
  await browser.close();
}
