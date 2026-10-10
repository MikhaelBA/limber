import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { logicWorkspaceFixture } from '../../../tools/logic-workspace-fixture.mjs';

const browser = await chromium.launch({ headless: true });
mkdirSync('packages/editor/.smoke', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } }),
    errors = [];
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__ticks > 2);
  const source = logicWorkspaceFixture(),
    scene = source.artboards[0];
  // Root keyboard confirm and character physical input intentionally have independent owners.
  scene.logic.routes.push({
    id: 'keyboard-label',
    targetId: null,
    event: 'click',
    parameterId: 'label',
    value: 'Keyboard confirm',
  });
  await page.locator('input[accept=".bbbproj,.json,application/json"]').setInputFiles({
    name: 'inputs.bbbproj',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page
    .locator('footer')
    .getByText(/Opened inputs.bbbproj/)
    .waitFor();
  const save = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  };
  const original = await save();
  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare native export', exact: true }).click();
  const preview = page.getByTestId('native-preview'),
    canvas = preview.locator('canvas');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="native-preview"]')?.dataset.ready === 'true',
  );
  await page.getByRole('button', { name: 'Pause native', exact: true }).click();
  const step = async () => page.getByRole('button', { name: 'Step native', exact: true }).click();
  const snapshot = async () => JSON.parse(await page.getByTestId('native-logic-snapshot').textContent());
  for (const [name, value] of [
    ['label', 'Native سلام 123'],
    ['alpha', '0.5'],
    ['color', '1193046'],
  ]) {
    const input = page.getByLabel(`Native parameter ${name}`, { exact: true });
    await input.fill(value);
    await input.press('Tab');
  }
  await page.getByLabel('Native parameter shown', { exact: true }).selectOption('false');
  assert.notEqual(
    (await snapshot()).parameters.label,
    'Native سلام 123',
    'queued input waits for accepted tick',
  );
  await step();
  const values = (await snapshot()).parameters;
  assert.equal(values.label, 'Native سلام 123');
  assert.equal(values.alpha, 0.5);
  assert.equal(values.color, 1193046);
  assert.equal(values.shown, false);
  await page.getByLabel('Native parameter alpha', { exact: true }).fill('1.1');
  await page.getByLabel('Native parameter alpha', { exact: true }).press('Tab');
  await page
    .getByRole('alert')
    .getByText(/\[0,1\]/)
    .waitFor();
  assert.equal(await page.getByLabel('Native parameter alpha', { exact: true }).inputValue(), '0.5');
  await step();
  assert.equal((await snapshot()).parameters.alpha, 0.5, 'invalid binding value cannot replace native truth');
  await page.getByRole('button', { name: 'Send test · Viewport', exact: true }).click();
  await step();
  assert.equal((await snapshot()).parameters.color, 0xabcdef);
  await canvas.focus();
  await page.keyboard.press('Enter');
  await step();
  assert.equal((await snapshot()).parameters.label, 'Keyboard confirm');
  const heldTick = await preview.getAttribute('data-tick');
  for (const preset of ['phone-portrait', 'phone-landscape', 'tablet', 'desktop', 'authored']) {
    await page.getByLabel('Native viewport preset', { exact: true }).selectOption(preset);
    assert.equal(
      await preview.getAttribute('data-tick'),
      heldTick,
      'responsive resize preserves native clock',
    );
    assert.equal(await preview.getAttribute('data-ready'), 'true');
  }
  const rigId = scene.nodes.find((node) => node.type === 'rig').id;
  await page.getByLabel('Native input owner', { exact: true }).selectOption(rigId);
  await page.getByLabel('Native parameter label', { exact: true }).fill('Character only');
  await page.getByLabel('Native parameter label', { exact: true }).press('Tab');
  await step();
  assert.equal((await snapshot()).parameters.label, 'Character only');
  await canvas.focus();
  await page.keyboard.press('Space');
  await step();
  await page.getByTestId('native-logic-state').filter({ hasText: 'Active' }).waitFor();
  assert.equal((await snapshot()).parameters.open, false, 'character trigger consumed by transition');
  await page.getByRole('button', { name: 'Reset native', exact: true }).click();
  assert.equal((await snapshot()).stateId, 'rig-idle');
  assert.equal(await preview.getAttribute('data-tick'), '0');
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await step();
  assert.equal((await snapshot()).stateId, 'rig-active', 'physical pointer dispatches to selected character');
  await page.getByLabel('Native input owner', { exact: true }).selectOption('');
  assert.equal(
    (await snapshot()).parameters.label,
    scene.logic.parameters.find((parameter) => parameter.name === 'label').initial,
    'character input does not mutate scene owner',
  );
  assert.deepEqual(
    await save(),
    original,
    'native inputs and device resizing never persist authoring values',
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    'packages/editor/.smoke/ship-inputs.json',
    JSON.stringify(
      {
        typedInputs: true,
        bindingValidation: true,
        characterKeyboard: true,
        characterPointer: true,
        independentOwners: true,
        responsiveClock: true,
        sourceUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Ship typed native parameters, atomic invalid input, scene/character keyboard ownership, test routes, responsive clock and unchanged source.',
  );
} finally {
  await browser.close();
}
