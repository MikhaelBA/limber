# BoneByBone Web runtime adapter

`@limber/runtime-web` owns browser pixel/font decoding and Pixi rendering. It has no
editor or React dependency. The compiler/player remain in renderer-free `@limber/runtime`.
The editor injects its texture registry and guides into the same tested scene/rig adapter.

```ts
import { Application } from 'pixi.js';
import { loadRuntime, NativeRuntimeAsset, NativeArtboardPlayer } from '@limber/runtime';
import { NativeWebAssets, NativeWebRenderer } from '@limber/runtime-web';

const asset = new NativeRuntimeAsset(loadRuntime(shippingBytes));
const assets = await NativeWebAssets.load(asset, {
  signal: abortController.signal,
  fonts: [{ family: 'Noto Sans Arabic', source: 'url(/fonts/NotoSansArabic.ttf)' }],
});
const player = new NativeArtboardPlayer(asset, { autoplay: true });
const view = new NativeWebRenderer(player, assets);
const app = new Application();
await app.init({ width: 800, height: 600, backgroundAlpha: 0 });
document.body.append(app.canvas);
view.world.position.set(400, 300);
app.stage.addChild(view.world);
app.ticker.add((ticker) => view.update(ticker.deltaMS / 1000));

// Host disposes the rendering adapter before shared assets.
view.destroy();
app.destroy(true);
assets.dispose();
```

Loading stages every required image and nongeneric font before publishing resources.
PNG/JPEG/WebP bodies must decode into real pixels; malformed data receives `IMAGE_DECODE`.
Missing font sources receive `MISSING_FONT`; broken font sources receive `FONT_DECODE`.
Generic CSS families explicitly use the host's system fonts. Font packaging in `.bbb`
and packed atlas ingestion remain asset-pipeline work; this API requires supplied font bytes
or font URLs. Nothing substitutes a placeholder for missing image IDs. Authored
untextured regions intentionally use white, tinted by their slot color.

The default image budget is 16384 pixels per dimension and 64 million total pixels.
Hosts may explicitly configure positive integer `maxDimension`/`maxPixels`. PNG dimensions
are checked before decode; all decoded image dimensions are checked before texture
publication. The loader revokes object URLs and destroys staged textures on failure or
cancellation. Fonts enter `document.fonts` only after staging succeeds and are removed
on disposal. Multiple players/renderers may share one asset publication; renderer
destruction never disposes shared assets. Dispose resources after the last renderer.

Production rendering has a transparent background and no editor guide geometry.
Scene/UI masks, nine-slice, shaped RTL text, rig draw order, exclusive clipping ends,
independent stencil masks and `0xRRGGBBAA` slot color share the editor's adapter.
`sync()` publishes host parameter/mode/resize changes without advancing time.
`update(delta)` and paused `step()` advance and synchronize, including accepted poses
when a host event callback throws. Geometry survives ordinary frames; a raw/Logic
skeleton publication or viewport resize rebuilds its owned scene geometry.

`hitTest(x, y)` takes artboard coordinates and returns a rendered ID suitable for
`player.dispatch(event, id)`. Convert screen coordinates through the host camera first.
`inspect()` returns on-demand render evidence; it is not used by the frame loop.
The browser gate downloads and reloads independent `.bbb` bytes, checks actual
source/native raster and RTL pixels, clipping/color goldens, geometry/text cache reuse,
responsive resize, interaction ownership, atomic decode/cancellation and resource cleanup.
Thirteen raster/native corpus projects pass initial-view pixel parity; two SVG corpus
projects retain explicit conversion diagnostics in the pure compiler; the worker now
converts their actual SVG pixels. Packed native export/load/render integration follows.

## Cancellable atlas preparation

`buildAtlasInWorker(input, { createWorker, signal, progress })` owns and terminates one
worker per job. The host creates a module worker whose entry imports
`@limber/runtime-web/asset-worker`, and supplies `input.wasmUrl` for SVG. The editor
host demonstrates Vite's explicit WASM asset import and worker source path in
`src/engine/nativeAtlasJob.ts`; runtime-web contains no Vite-specific imports.

Inputs contain stable IDs, MIME, original `ArrayBuffer` bytes and optional per-image
trim locks. Layout/raster options come from `@limber/atlas`. Source buffers are cloned
by worker messaging; they remain attached to the author's project. Raster dimensions
are preflighted before real worker body decode. SVG uses unmodified resvg/WASM and
its PNG interchange, followed by real bitmap decode. Unresolved external SVG images
fail explicitly; SVG text needs supplied font buffers. Animated PNG/WebP are rejected
with an individual-frame import remedy instead of silently shipping a first frame.

Progress is monotonic across decode/prepare/pack/compose/encode. Results contain only
logical region/crop/scale metadata, physical layouts, actual PNG page bytes and measured
work/timing evidence. Pixel pages remain straight-alpha (`premultiplied: false`). No
resource is installed in the host while preparing. The consumer validates dimensions,
crop/source bounds, frame/gutter occupancy, PNG headers, identities and metrics before
accepting a result. A pre-aborted request creates no worker; active cancellation
terminates synchronous WASM/packing too. Errors retain codes, object IDs and remedies.

Default/hard decoded and prepared budgets are 64 Mi pixels per stage, capped again
before resized/page output allocation. Images are limited to 16 MiB each and 64 MiB
in aggregate; SVG font bytes to 16 MiB; encoded pages to 128 MiB. The independent
browser gate verifies RGBA/rotation/gutter/trim goldens, all three raster formats,
damaged body/resource/font/budget findings, cancellation and all fifteen source
projects (including asset-free ones and Fox). It also builds and serves a production
host to prove emitted worker/WASM paths and real output pixels. Upstream source/license
notices are retained in this package and distributed under the editor's `licenses/`.
