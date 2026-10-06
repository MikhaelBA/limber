// Standalone demo entry for /examples/runtime-demo.html — bundles into an
// IIFE (see `npm run build:demo` in @limber/runtime). Regenerate + commit
// after changing the player: the CI does not build this artifact.
import { deserializeDocument } from '@limber/core';
import { RuntimePlayer, renderWireframe } from '../src/player';

async function start(canvas: HTMLCanvasElement): Promise<void> {
  const res = await fetch('demo.limber.json');
  const doc = deserializeDocument(await res.text());
  const player = new RuntimePlayer(doc);
  player.setAnimation('wave');
  const log = document.getElementById('log')!;
  const timeLabel = document.getElementById('time')!;
  player.onEvent((e) => {
    log.textContent = `⚡ ${e.eventName} @ ${e.time.toFixed(2)}s`;
  });

  const ctx = canvas.getContext('2d')!;
  const draw = (): void => {
    player.update(1 / 60);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 + 40);
    renderWireframe(ctx, player);
    ctx.restore();
    timeLabel.textContent = `${player.time.toFixed(2)}s / ${player.duration.toFixed(2)}s`;
  };

  // Same rAF-frozen-webview guard as the editor: some embedded browsers stop
  // rAF entirely while "visible" — a timer watchdog keeps the demo animating.
  let lastFrameAt = performance.now();
  const frame = (): void => {
    lastFrameAt = performance.now();
    draw();
  };
  requestAnimationFrame(function loop() {
    frame();
    requestAnimationFrame(loop);
  });
  setInterval(() => {
    if (performance.now() - lastFrameAt > 250) draw();
  }, 120);
}

void start(document.querySelector('canvas')!).catch((e: unknown) => {
  const log = document.getElementById('log')!;
  log.textContent = `demo failed: ${(e as Error).message}`;
});
