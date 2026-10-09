import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { installHeldWorkers } from '../../../tools/held-worker-harness.mjs';
import { meshFixture } from '../../../tools/mesh-fixtures.mjs';

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installHeldWorkers);
  await page.goto(process.env.SPRINE_URL ?? 'http://localhost:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const open = async (project) => page.locator('input[type=file]').setInputFiles({ name: 'weights.bbbproj', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const save = async () => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save', exact: true }).click(); return JSON.parse(readFileSync(await (await pending).path(), 'utf8')); };
  const select = async () => page.getByText(/^bind test mesh/).first().click();
  const start = async () => { await page.getByRole('button', { name: 'Auto weights', exact: true }).click(); await page.getByRole('progressbar', { name: 'Auto weights progress' }).waitFor(); };
  const done = async () => page.waitForFunction(() => window.__workerJobs.at(-1)?.result !== null);
  const name = page.getByRole('complementary', { name: 'Character properties' }).getByRole('textbox', { name: 'Name', exact: true }).first();
  const metrics = [];
  for (const kind of ['Standard', 'Heavy']) {
    const source = meshFixture(kind); await open(source); await select();
    const before = await save();
    await start(); await done();
    const stats = await page.evaluate(() => {
      const job = window.__workerJobs.at(-1);
      const sorted = [...job.gaps].sort((a, b) => a - b);
      return { durationMs: job.result.durationMs, frames: job.frames, frameGapP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, maxFrameGapMs: sorted.at(-1) ?? 0 };
    });
    if (stats.durationMs > 100) assert.ok(stats.frames >= 2, `${kind} did not render while computing`);
    const publicationMs = await page.evaluate(() => window.__releaseWeights());
    await page.locator('footer').getByText(/Auto weights applied/).waitFor();
    const after = await save(), weights = after.artboards[0].nodes[0].skeleton.attachments[0].weights;
    let cursor = 0, count = 0;
    while (cursor < weights.length) {
      const size = weights[cursor++]; assert.ok(size >= 1 && size <= 4); let sum = 0;
      const seen = new Set();
      for (let i = 0; i < size; i++) { const bone = weights[cursor++], weight = weights[cursor++]; assert.ok(bone >= 0 && bone < source.artboards[0].nodes[0].skeleton.bones.length && !seen.has(bone)); seen.add(bone); assert.ok(Number.isFinite(weight) && weight >= 0); sum += weight; }
      assert.ok(Math.abs(sum - 1) < 1e-8); count++;
    }
    assert.equal(count, kind === 'Standard' ? 2500 : 10000);
    assert.deepEqual(weights.slice(0, 3), [1, 0, 1]);
    await page.keyboard.press('Control+z'); assert.deepEqual(await save(), before);
    await page.keyboard.press('Control+y'); assert.deepEqual(await save(), after);
    await open(after); await select(); assert.deepEqual(await save(), after);
    metrics.push({ kind, vertices: count, bones: source.artboards[0].nodes[0].skeleton.bones.length, publicationMs, ...stats });
  }
  // An aborted job preserves source and redo; redo is created by an ordinary name edit.
  await open(meshFixture('Standard')); await select();
  await name.fill('renamed'); await name.press('Enter');
  await page.keyboard.press('Control+z'); const before = await save();
  await start(); await page.getByRole('button', { name: 'Cancel auto weights', exact: true }).click();
  await page.locator('footer').getByText('Auto weights cancelled.', { exact: true }).waitFor();
  assert.deepEqual(await save(), before);
  assert.equal(await page.evaluate(() => window.__workerJobs.at(-1).terminated), true);
  await page.keyboard.press('Control+y'); assert.equal((await save()).artboards[0].nodes[0].skeleton.slots[0].name, 'renamed');
  await page.keyboard.press('Control+z');
  await start(); await done(); await name.fill('changed during job'); await name.press('Enter');
  const changed = await save(); await page.evaluate(() => window.__releaseWeights());
  await page.locator('footer').getByText(/discarded because the rig changed/).waitFor();
  assert.deepEqual(await save(), changed);
  await page.keyboard.press('Control+z'); assert.deepEqual(await save(), before);
  await page.keyboard.press('Control+y'); assert.deepEqual(await save(), changed);
  await start(); await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page.getByRole('progressbar', { name: 'Auto weights progress' }).waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__workerJobs.at(-1).terminated), true);
  assert.deepEqual(await save(), changed);
  assert.deepEqual(errors, []);
  writeFileSync('packages/editor/.smoke/auto-weights-metrics.json', JSON.stringify(metrics, null, 2));
  console.log('PASS: real Standard/Heavy auto-weight workers, progress, rendering during computation, normalized rows, exact history/roundtrip, hard cancellation, stale isolation and mode cancellation', JSON.stringify(metrics));
} finally { await browser.close(); }
