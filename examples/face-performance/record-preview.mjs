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
  const recording = await page.evaluate(async (program) => {
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
      chunks = [],
      frames = [];
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
        if ([3, 6, 10, 16, 23, 32, 49, 66].includes(frame))
          frames.push({ name, time: (frame + 1) / 20, image: app.canvas.toDataURL() });
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
    return { bytes, frames };
  }, program);
  assert.deepEqual(errors, []);
  writeFileSync(join(here, 'previews/Facial-Performances.webm'), Buffer.from(recording.bytes));
  await page.setViewportSize({ width: 1280, height: 680 });
  await page.setContent(
    `<body style="margin:0;background:#242831;color:white;font:12px Arial"><div style="display:grid;grid-template-columns:repeat(8,160px)">${recording.frames.map((frame) => `<div><img width="160" height="160" src="${frame.image}"><div>${frame.name} ${frame.time.toFixed(2)}s</div></div>`).join('')}</div></body>`,
  );
  await page.screenshot({ path: join(here, 'previews/acting-review.png'), fullPage: true });
  console.log(
    `Recorded four native facial performances (${recording.bytes.length} bytes) and 32 review frames.`,
  );
} finally {
  await browser.close();
}
