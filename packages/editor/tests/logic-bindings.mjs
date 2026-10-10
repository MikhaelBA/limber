import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { logicBindingsFixture } from '../../../tools/logic-bindings-fixture.mjs';
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
      .locator('input[type=file][accept^=".bbbproj"]')
      .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const project = logicBindingsFixture();
  await open(project, 'bindings.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened bindings.bbbproj/)
    .waitFor();
  const saved = await save();
  assert.deepEqual(saved, project);
  const result = await page.evaluate(
    async ({ project, moduleUrl }) => {
      const { SceneLogicPlayer, expandUIComponents } = await import(moduleUrl);
      const snapshots = [];
      for (const fps of [10, 60, 120, 144, 240, 1000]) {
        const player = new SceneLogicPlayer(project.artboards[0], project.components);
        player.setString('label', 'سلام دنیا 🌿');
        player.setFloat('alpha', 0.25);
        player.setInt('color', 0xabcdef);
        player.setBool('shown', false);
        for (let frame = 0; frame < fps; frame++) player.update(1 / fps);
        const expanded = expandUIComponents(project, player.getView()).artboard;
        snapshots.push({
          state: player.snapshot(),
          nodes: expanded.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            text: n.text,
            tint: n.tint,
            visible: n.visible,
            opacity: n.opacity,
          })),
        });
        player.setEnabled(false);
        if (player.getView().nodes[1].text !== 'متن ذخیره‌شده')
          throw new Error('Disabled text must be authored');
      }
      return snapshots;
    },
    { project: saved, moduleUrl: `/@fs/${resolve('packages/core/src/index.ts').replaceAll('\\', '/')}` },
  );
  for (const value of result) assert.deepEqual(value, result[0]);
  const texts = result[0].nodes.filter((n) => n.type === 'text');
  assert.equal(texts.length, 2);
  assert.ok(texts.every((n) => n.text === 'سلام دنیا 🌿'));
  const child = texts.find((n) => n.id !== 'direct');
  assert.equal(child.opacity, 0.25);
  assert.equal(child.visible, false);
  assert.equal(child.tint, 0xabcdef);
  for (const [index, mutate] of [
    (p) => {
      p.artboards[0].logic.bindings[0].exposureName = 'missing';
    },
    (p) => {
      p.artboards[0].logic.parameters[2].initial = 2;
    },
    (p) => {
      p.artboards[0].nodes[1].binding = 'shown';
    },
  ].entries()) {
    const bad = structuredClone(saved);
    mutate(bad);
    await open(bad, `bad-binding-${index}.bbbproj`);
    await page
      .locator('footer')
      .getByText(/Open failed:/)
      .waitFor();
    assert.deepEqual(await save(), saved);
  }
  await open(saved, 'bindings-reopened.bbbproj');
  await page
    .locator('footer')
    .getByText(/Opened bindings-reopened.bbbproj/)
    .waitFor();
  assert.deepEqual(await save(), saved);
  writeFileSync('packages/editor/.smoke/bindings.bbbproj', JSON.stringify(saved, null, 2));
  await page.screenshot({ path: 'packages/editor/.smoke/logic-bindings.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: exposed text/visibility/opacity/tint and direct RTL bindings, exact native Save/Open, malformed import isolation, 10–1000Hz view parity; graph preview UI follows separately',
  );
} finally {
  await browser.close();
}
