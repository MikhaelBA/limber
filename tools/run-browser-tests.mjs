import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const editorRequire = createRequire(resolve(root, 'packages/editor/package.json'));
const viteBin = resolve(dirname(editorRequire.resolve('vite/package.json')), 'bin/vite.js');
const port = process.env.BBB_TEST_PORT ?? '5183';
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', port, '--strictPort'], {
  cwd: resolve(root, 'packages/editor'),
  stdio: 'inherit',
  windowsHide: true,
});
let serverExit;
server.on('exit', (code) => {
  serverExit = code ?? -1;
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (serverExit !== undefined) throw new Error(`Test server exited: ${serverExit}`);
    try {
      ready = (await fetch(url)).ok;
    } catch {
      /* Still starting. */
    }
    if (ready) break;
    await setTimeout(100);
  }
  if (!ready) throw new Error('Test server did not start.');
  for (const test of [
    'smoke.mjs',
    'viewport-feedback.mjs',
    'project-files.mjs',
    'recovery.mjs',
    'scene-workspace.mjs',
    'scene-interaction.mjs',
    'scene-motion.mjs',
    'scene-ui.mjs',
    'rig-authoring.mjs',
    'character-pins.mjs',
    'affine-pins.mjs',
    'transform-follow.mjs',
    'path-follow.mjs',
    'secondary-motion.mjs',
    'logic-source.mjs',
    'logic-playback.mjs',
    'typed-events.mjs',
    'weight-tools.mjs',
    'mesh-binding.mjs',
    'auto-weights.mjs',
    'auto-mesh.mjs',
    'smooth-weights.mjs',
    'shared-meshes.mjs',
    'mesh-performance.mjs',
    'constraint-performance.mjs',
  ]) {
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, [resolve(root, 'packages/editor/tests', test)], {
        cwd: root,
        env: { ...process.env, SPRINE_URL: url },
        stdio: 'inherit',
        windowsHide: true,
      });
      child.on('error', reject);
      child.on('exit', resolveExit);
    });
    if (code !== 0) throw new Error(`${test} failed (${code}).`);
  }
} finally {
  server.kill();
}
