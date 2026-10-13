import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SPRINE_URL ?? 'http://127.0.0.1:5183/');
  await page.waitForFunction(() => window.__ticks > 2);
  const bone = (id, parentId = null, pose = {}) => ({
    id,
    name: id,
    parentId,
    length: 140,
    setupPose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, ...pose },
  });
  const open = async (bones, geometry = {}) => {
    await page.locator('input[type=file]').setInputFiles({
      name: 'pointer.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          version: 2,
          skeleton: {
            bones,
            slots: [],
            attachments: [],
            ikConstraints: [],
            skins: [],
            activeSkin: '',
            ...geometry,
          },
          animations: [],
          assetManifest: {},
        }),
      ),
    });
    await page
      .locator('footer')
      .getByText(/Opened pointer.json/)
      .waitFor();
  };
  const select = (id) =>
    page
      .locator('[draggable=true]')
      .filter({ has: page.getByText(id, { exact: true }) })
      .click();
  const screen = (p) => page.evaluate((p) => window.__worldToScreen(p.x, p.y), p);
  const save = async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  };
  const pose = (project, id) =>
    project.artboards[0].nodes[0].skeleton.bones.find((b) => b.id === id).setupPose;
  const drag = async (from, to) => {
    await page.mouse.move(...(await screen(from)));
    await page.mouse.down();
    await page.mouse.move(...(await screen(to)), { steps: 12 });
    await page.mouse.up();
  };
  const gizmo = () => page.evaluate(() => window.__rigGizmo);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);
  await open([bone('root')]);
  await select('root');
  assert.equal(
    await page.getByTitle('Play/Pause (Space)', { exact: true }).count(),
    0,
    'Setup gives canvas space to rig authoring',
  );
  await page.locator('canvas').evaluate((canvas) => {
    canvas.dataset.identity = 'original';
  });
  const original = await save();
  // Body grab keeps its offset rather than snapping the origin under the cursor.
  await drag({ x: 100, y: 0 }, { x: 110, y: 20 });
  let current = pose(await save(), 'root');
  near(current.x, 10);
  near(current.y, 20);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original);
  let g = await gizmo();
  await drag(g.x, { x: g.x.x + 24, y: g.x.y + 30 });
  current = pose(await save(), 'root');
  near(current.x, 24);
  near(current.y, 0);
  await page.keyboard.press('Control+z');
  await page.mouse.move(...(await screen({ x: 100, y: 0 })));
  await page.mouse.down();
  await page.mouse.move(...(await screen({ x: 130, y: 25 })));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await save(), original, 'Escape restores the live pose');
  assert.equal(
    await page.getByTitle('Redo (Ctrl+Shift+Z / Ctrl+Y)').isEnabled(),
    true,
    'cancellation preserves redo',
  );
  await page.mouse.move(...(await screen({ x: 100, y: 0 })));
  await page.mouse.down();
  await page.mouse.move(...(await screen({ x: 130, y: 25 })));
  await page.locator('canvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  assert.deepEqual(await save(), original, 'pointer cancellation restores the live pose');
  await drag({ x: 100, y: 0 }, { x: 101, y: 1 });
  assert.deepEqual(await save(), original, 'a click jitter cannot leave an untracked edit');
  await page.keyboard.press('x');
  g = await gizmo();
  await drag(g.x, { x: g.x.x + 32, y: g.x.y });
  current = pose(await save(), 'root');
  near(current.scaleX, 1.5);
  near(current.scaleY, 1);
  await page.keyboard.press('v');
  const lengthHandle = await page.evaluate(() => window.__rigLengthHandle);
  await drag(lengthHandle, { x: lengthHandle.x + 45, y: lengthHandle.y });
  assert.equal(
    (await save()).artboards[0].nodes[0].skeleton.bones[0].length,
    170,
    'length uses bone units under scale',
  );
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), original);
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  assert.equal(await page.getByTitle('Play/Pause (Space)', { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: '＋ Bone', exact: true }).count(), 0);
  assert.equal(
    await page.locator('canvas').getAttribute('data-identity'),
    'original',
    'changing workflow keeps the same WebGL canvas',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Grid', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  assert.equal(await page.getByLabel('Bone parent', { exact: true }).count(), 0);
  assert.equal(await page.getByTitle('Add root bone', { exact: true }).count(), 0);
  await page.keyboard.press('x');
  const beforeKeys = await save();
  g = await gizmo();
  const dx = g.free.x - g.origin.x,
    dy = g.free.y - g.origin.y,
    length = Math.hypot(dx, dy);
  await drag(g.free, { x: g.free.x + (dx / length) * 32, y: g.free.y + (dy / length) * 32 });
  assert.notDeepEqual(await save(), beforeKeys);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), beforeKeys, 'both scale tracks undo together');
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Grid', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  assert.equal(
    await page.getByTitle('Play/Pause (Space)', { exact: true }).isVisible(),
    true,
    'Setup timeline remains optionally accessible',
  );
  // A reflected, sheared parent exposes errors hidden by a plain root rig.
  await open([
    bone('parent', null, { rotation: 0.3, scaleX: -2, scaleY: 0.65, shearX: 0.35 }),
    bone('child', 'parent', { x: -70, y: 80, rotation: 0.4 }),
  ]);
  await select('child');
  await page.keyboard.press('c');
  g = await gizmo();
  const c = Math.cos(0.3),
    s = Math.sin(0.3),
    sh = Math.tan(0.35);
  const m = [-2 * c, -2 * s, 0.65 * (c * sh - s), 0.65 * (s * sh + c)];
  const point = (angle) => {
    const x = m[0] * Math.cos(angle) + m[2] * Math.sin(angle),
      y = m[1] * Math.cos(angle) + m[3] * Math.sin(angle);
    return {
      x: g.origin.x + (x / Math.hypot(x, y)) * g.radius,
      y: g.origin.y + (y / Math.hypot(x, y)) * g.radius,
    };
  };
  await drag(point(0.5), point(0.9));
  near(pose(await save(), 'child').rotation, 0.8);
  await page.keyboard.press('Control+z');
  near(pose(await save(), 'child').rotation, 0.4);
  mkdirSync('packages/editor/.smoke/rig-pointer', { recursive: true });
  await page.screenshot({ path: 'packages/editor/.smoke/rig-pointer/setup.png' });
  // Both creation entry points attach children at the parent's local tip.
  await open([bone('root')]);
  await select('root');
  const beforeChildren = await save();
  await page.getByTitle('Add child of selected', { exact: true }).click();
  let added = (await save()).artboards[0].nodes[0].skeleton.bones.at(-1);
  assert.equal(added.parentId, 'root');
  near(added.setupPose.x, 140);
  near(added.setupPose.y, 0);
  near((await gizmo()).origin.x, 140);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), beforeChildren);
  await page.keyboard.press('Control+y');
  near((await save()).artboards[0].nodes[0].skeleton.bones.at(-1).setupPose.x, 140);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('b');
  await page.mouse.click(...(await screen({ x: 70, y: 0 })));
  const clickedChild = await save();
  added = clickedChild.artboards[0].nodes[0].skeleton.bones.at(-1);
  assert.equal(added.parentId, 'root');
  near(added.setupPose.x, 140);
  near(added.setupPose.y, 0);
  near(added.setupPose.rotation, 0);
  near(added.length, 50);
  // The next child extends the chain, rather than appearing at its parent's centre.
  const firstChildId = added.id;
  await page.mouse.click(...(await screen({ x: 165, y: 0 })));
  added = (await save()).artboards[0].nodes[0].skeleton.bones.at(-1);
  assert.equal(added.parentId, firstChildId);
  near(added.setupPose.x, 50);
  near((await gizmo()).origin.x, 190);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), clickedChild);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), beforeChildren);
  await drag({ x: 70, y: 0 }, { x: 180, y: 30 });
  const draggedChild = await save();
  added = draggedChild.artboards[0].nodes[0].skeleton.bones.at(-1);
  near(added.setupPose.x, 140);
  near(added.setupPose.y, 0);
  near(added.setupPose.rotation, Math.atan2(30, 40));
  near(added.length, 50);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), beforeChildren);
  await page.keyboard.press('Control+y');
  assert.deepEqual(await save(), draggedChild);
  // Affine parents must snap to the actual world tip and resolve the release in local space.
  await open([bone('parent', null, { rotation: 0.3, scaleX: -2, scaleY: 0.65, shearX: 0.35 })]);
  await select('parent');
  await page.keyboard.press('b');
  const affineBefore = await save();
  const affinePoint = (x, y) => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
  await drag(affinePoint(70, 0), affinePoint(170, 40));
  added = (await save()).artboards[0].nodes[0].skeleton.bones.at(-1);
  assert.equal(added.parentId, 'parent');
  near(added.setupPose.x, 140);
  near(added.setupPose.y, 0);
  near(added.setupPose.rotation, Math.atan2(40, 30));
  near(added.length, 50);
  near((await gizmo()).origin.x, affinePoint(140, 0).x);
  near((await gizmo()).origin.y, affinePoint(140, 0).y);
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), affineBefore);
  // Cancelling creation preserves the existing rig and history.
  await page.mouse.move(...(await screen(affinePoint(70, 0))));
  await page.mouse.down();
  await page.mouse.move(...(await screen(affinePoint(170, 40))));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await save(), affineBefore);
  // Empty canvas still permits independent roots, and point bones have coincident tips.
  await drag({ x: 220, y: 150 }, { x: 260, y: 180 });
  added = (await save()).artboards[0].nodes[0].skeleton.bones.at(-1);
  assert.equal(added.parentId, null);
  near(added.setupPose.x, 220);
  near(added.setupPose.y, 150);
  await open([{ ...bone('controller'), length: 0 }]);
  await page.keyboard.press('b');
  await page.mouse.click(...(await screen({ x: 0, y: 0 })));
  added = (await save()).artboards[0].nodes[0].skeleton.bones.at(-1);
  assert.equal(added.parentId, 'controller');
  near(added.setupPose.x, 0);
  near(added.setupPose.y, 0);
  await open([bone('root')], {
    slots: [
      { id: 'mesh-slot', name: 'mesh-slot', boneId: 'root', defaultAttachmentId: 'mesh', color: 0xffffffff },
    ],
    attachments: [
      {
        id: 'mesh',
        name: 'mesh',
        type: 'mesh',
        textureId: 'missing',
        meshVertices: [-60, 80, 60, 80, 0, 180],
        meshUVs: [0, 0, 1, 0, 0.5, 1],
        meshTriangles: [0, 1, 2],
        meshHull: [0, 1, 2],
      },
    ],
  });
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await page.keyboard.press('m');
  const topologyBefore = await save();
  await page.keyboard.down('Alt');
  await page.mouse.click(...(await screen({ x: -60, y: 80 })));
  await page.keyboard.up('Alt');
  await page.mouse.dblclick(...(await screen({ x: 0, y: 120 })));
  assert.deepEqual(await save(), topologyBefore, 'Deform cannot accidentally add/delete topology');
  await drag({ x: -60, y: 80 }, { x: -70, y: 90 });
  const deformed = await save();
  assert.deepEqual(deformed.artboards[0].nodes[0].skeleton, topologyBefore.artboards[0].nodes[0].skeleton);
  assert(deformed.artboards[0].nodes[0].animations[0].timelines.some((t) => t.kind === 'deform'));
  await page.keyboard.press('Control+z');
  assert.deepEqual(await save(), topologyBefore);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real rig handles, tip-only child creation/click/drag/chaining under affine parents, exact history/cancellation, root/point bones and distinct Setup/Animate layouts.',
  );
} finally {
  await browser.close();
}
