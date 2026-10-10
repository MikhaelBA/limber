import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

mkdirSync('packages/editor/.smoke', { recursive: true });
const source = JSON.parse(readFileSync('fixtures/bbbproj-v10-logic.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const result = await page.evaluate(
    async ({ source, moduleUrl }) => {
      const { SceneLogicPlayer, RigLogicPlayer, activeRigNode } = await import(moduleUrl);
      const before = JSON.stringify(source),
        owner = activeRigNode(source),
        results = [];
      for (const hz of [10, 60, 120, 144, 240, 1000]) {
        const scene = new SceneLogicPlayer(source.artboards[0]),
          rig = new RigLogicPlayer(owner);
        for (const player of [scene, rig]) player.fire('open');
        for (let n = 0; n < hz; n++) {
          scene.update(1 / hz);
          rig.update(1 / hz);
        }
        results.push({
          hz,
          scene: scene.snapshot(),
          rig: rig.snapshot(),
          pose: scene.getPose(),
          matrices: Array.from(rig.getWorldTransforms()),
          vertices: [...rig.skeleton.pose.attachments].map(([id, a]) => [id, Array.from(a.verts)]),
        });
      }
      const scene = new SceneLogicPlayer(source.artboards[0]),
        rig = new RigLogicPlayer(owner),
        held = [];
      for (const player of [scene, rig]) {
        player.fire('open');
        player.update(0.05);
        const before = player.snapshot();
        player.setEnabled(false);
        player.update(5);
        player.setEnabled(true);
        held.push({ before, after: player.snapshot() });
        player.pause();
        player.update(5);
        player.play();
        if (player.snapshot().tick !== before.tick) throw new Error('Pause advanced Logic.');
      }
      return { results, held, sourceUnchanged: before === JSON.stringify(source) };
    },
    { source, moduleUrl: `/@fs/${resolve('packages/core/src/index.ts').replaceAll('\\', '/')}` },
  );
  assert.equal(result.sourceUnchanged, true);
  const reference = { ...result.results[0], hz: 0 };
  for (const sample of result.results) assert.deepEqual({ ...sample, hz: 0 }, reference);
  for (const sample of result.held) {
    assert.equal(sample.before.tick, 6);
    assert.equal(sample.after.tick, 6);
    assert.deepEqual(sample.after.transition, sample.before.transition);
    assert.deepEqual(sample.after.parameters, sample.before.parameters);
  }
  assert.deepEqual(errors, []);
  writeFileSync('packages/editor/.smoke/logic-playback.json', JSON.stringify(result, null, 2));
  console.log(
    'PASS: browser portable scene/rig Logic playback, exact matrices/vertices across six frame groupings, paused/disabled blend retention and source preservation; editor preview UI remains separate',
  );
} finally {
  await browser.close();
}
