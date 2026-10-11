import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../..');
const program = JSON.parse(readFileSync(join(root, '.smoke/face-performance/program.json'), 'utf8'));
mkdirSync(join(here, 'previews'), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('tests/native-web.html', process.env.SPRINE_URL ?? 'http://127.0.0.1:5196/').href);
  const bytes = await page.evaluate(async (program) => {
    const { runtime, web, pixi } = await import('/tests/native-web-host.ts');
    const asset = new runtime.NativeRuntimeAsset(program),
      assets = await web.NativeWebAssets.load(asset),
      player = new runtime.NativeArtboardPlayer(asset),
      view = new web.NativeWebRenderer(player, assets);
    const app = new pixi.Application();
    await app.init({
      width: 640,
      height: 640,
      resolution: 1,
      backgroundColor: 0x242831,
      antialias: true,
      preference: 'webgl',
      autoStart: false,
    });
    document.querySelector('#stage').append(app.canvas);
    view.world.position.set(0, 0);
    app.stage.addChild(view.world);
    const label = new pixi.Text({ text: '', style: { fontFamily: 'Arial', fontSize: 22, fill: 0xffffff } });
    label.position.set(20, 18);
    app.stage.addChild(label);
    const stream = app.canvas.captureStream(0),
      track = stream.getVideoTracks()[0],
      chunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 2200000,
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start();
    for (const [name, duration] of [
      ['Talking', 4],
      ['Crying', 5],
      ['Head Tilt', 4],
      ['Laughing', 4],
    ]) {
      label.text = name;
      player.getRig('face-rig').play(name, { loop: true });
      player.pause();
      for (let frame = 0; frame < duration * 20; frame++) {
        for (let tick = 0; tick < 6; tick++) view.step();
        app.render();
        track.requestFrame();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const bytes = [...new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())];
    view.destroy();
    app.destroy(true);
    assets.dispose();
    return bytes;
  }, program);
  assert.deepEqual(errors, []);
  writeFileSync(join(here, 'previews/Facial-Performances.webm'), Buffer.from(bytes));
  console.log(`Recorded four native facial performances (${bytes.length} bytes).`);
} finally {
  await browser.close();
}
