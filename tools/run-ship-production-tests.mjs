import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';

const root = resolve(import.meta.dirname, '..'),
  editor = resolve(root, 'packages/editor');
const dist = resolve(editor, 'dist'),
  assets = readdirSync(resolve(dist, 'assets'));
assert(
  assets.some((name) => name.startsWith('assetWorker-') && name.endsWith('.js')),
  'Native worker must be emitted in the main production bundle.',
);
assert(
  assets.some((name) => name.endsWith('.wasm')),
  'Production resvg WASM must be emitted.',
);
assert(readFileSync(resolve(dist, 'licenses/resvg/LICENSE.txt'), 'utf8').includes('Mozilla Public License'));
assert(
  readFileSync(resolve(dist, 'licenses/xmldom/LICENSE.txt'), 'utf8').includes('Permission is hereby granted'),
);
assert(readFileSync(resolve(dist, 'fonts/OFL-NotoSansArabic.txt'), 'utf8').includes('SIL OPEN FONT LICENSE'));

// Vite preview serves built artifacts only; an ephemeral owned port avoids user-server collisions.
const server = await preview({
  root: editor,
  configFile: resolve(editor, 'vite.config.ts'),
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
});
try {
  const address = server.httpServer.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/`;
  for (const test of ['ship-workspace.mjs', 'ship-inputs.mjs', 'ship-doctor-ui.mjs', 'weight-painting.mjs']) {
    const code = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve(editor, 'tests', test)], {
        cwd: root,
        env: {
          ...process.env,
          SPRINE_URL: url,
          BBB_SHIP_EVIDENCE_DIR: resolve(editor, '.smoke/ship-production'),
          BBB_WEIGHT_EVIDENCE_DIR: resolve(editor, '.smoke/ship-production/weights'),
        },
        stdio: 'inherit',
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('exit', done);
    });
    assert.equal(code, 0, `Production ${test} must pass.`);
  }
  console.log(
    'PASS: main production Ship workflow uses emitted worker/WASM/font/license resources; all three packaged interaction/Doctor gates and real weight painting passed.',
  );
} finally {
  await new Promise((done, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : done()));
    server.httpServer.closeAllConnections();
  });
}
