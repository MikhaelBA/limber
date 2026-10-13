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
  // Serve the same emitted artifact below a repository path, as GitHub Pages does.
  base: '/limber/',
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
});
try {
  const address = server.httpServer.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/limber/`;
  const html = await (await fetch(url)).text();
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert(references.some((reference) => reference.endsWith('.js')));
  for (const reference of references) {
    const resource = new URL(reference, url);
    assert(
      resource.pathname.startsWith('/limber/'),
      `Resource must stay under the deployment path: ${resource}`,
    );
    const response = await fetch(resource);
    assert.equal(response.status, 200, `Emitted resource must load: ${resource}`);
    assert(
      !response.headers.get('content-type')?.includes('text/html'),
      `Resource must not resolve to SPA HTML: ${resource}`,
    );
  }
  for (const test of [
    'ship-workspace.mjs',
    'ship-inputs.mjs',
    'ship-doctor-ui.mjs',
    'weight-painting.mjs',
    'weight-workflow.mjs',
    'rig-pointer-workflow.mjs',
    'selection-feedback.mjs',
    'rig-organization.mjs',
    'deform-workflow.mjs',
    'spine-import-workflow.mjs',
    'spine43-import-workflow.mjs',
  ]) {
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
    'PASS: production resources and all eleven browser workflows load under /limber/, including emitted workers/WASM/fonts, packaged interaction/Doctor, weights, rig handles, selection, slot order, bone colors/icons, practical Deform and Spine 4.2/4.3 import.',
  );
} finally {
  await new Promise((done, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : done()));
    server.httpServer.closeAllConnections();
  });
}
