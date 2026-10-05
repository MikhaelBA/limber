# Limber — Project Status & Task List

> Handoff document: read this + [DESIGN.md](./DESIGN.md) before continuing work.
> Last updated: 2026-10-05 (after Phase 4: attachments, draw order & skins).

## Current status

| Area | State |
|---|---|
| Phase 1 — Core engine (data model, FK, serialization) | ✅ done |
| Phase 2 — Rigging editor (viewport, hierarchy, undo/redo) | ✅ done |
| Phase 3 — Animation & timeline (mixer, dopesheet, auto-key) | ✅ done |
| Phase 4 — Attachments, draw order & skins | ✅ done |
| Docker (multi-stage, nginx, ~75MB) | ✅ done & verified |
| CI/CD (tests → GHCR image → GitHub Pages) | ✅ done & verified on GitHub |
| Rename to Limber | ✅ done (folder is now `Documents/GitHub/Limber`) |

Verification baseline: **101 unit tests green**, typecheck green, editor production
build green, Playwright smoke green **headless AND headed** (`HEADLESS=0`), including
drop-image → sprite-follows-bone and composite undo/redo.

## Phase 4 — what landed

- **Texture registry** (`editor/src/engine/TextureRegistry.ts`): browser-only module
  (deliberately outside the DOM-free `EditorEngine`), keyed by `textureId`, loads via
  File API + `URL.createObjectURL`, records `document.assetManifest` entries through
  the undoable `AddTextureCommand`. Cleared (URLs revoked, GPU freed) on New/Open.
- **Drop-on-viewport flow**: dropping an image = ONE `CompositeCommand`
  (AddTexture + AddSlot + AddAttachment), so one undo removes everything. Slot is
  created on the selected bone (or root) and the region is sized to the texture.
- **Slot/attachment/skin commands** (`slotCommands.ts`, `attachmentCommands.ts`,
  `skinCommands.ts`): all undoable; structural ones rebuild. `RemoveSlot`/`RemoveAttachment`
  capture & restore every cross-reference (skin entries, slotColor/slotAttachment
  timelines, slot defaults). `ReorderSlot` re-maps existing drawOrder keyframes
  old-index → slot id → new-index.
- **Viewport rendering**: one quad `Mesh` per slot; vertices transformed on the CPU
  against `pose.worldMatrices` every tick (exact under shear, no lossy decompose);
  tint/alpha from the packed slot color; `zIndex` follows `pose.slotOrder`. Attachment
  picking (point-in-quad) selects slots when no bone is hit.
- **Keyframes**: `KeySlotColorCommand` (auto-key from the color control in Animate
  mode), `KeyDrawOrderCommand` (stepped permutation; animate-mode ↑/↓ in the
  hierarchy auto-keys the new order), + delete commands. Dopesheet gained a draw-order
  row and one color row per slot (click-select, Del deletes).
- **UI**: Slots section in HierarchyPanel (add/reorder/delete), slot + skins sections
  in PropertiesPanel (bone binding, color/alpha, attachment select, region X/Y/W/H,
  "New region" from texture, skin create/select/delete).

Known Phase-4 limitations (by design, revisit later): textures are not persisted
(re-drop after Open — Phase 7/8), drawOrder/slotColor keyframes are not draggable in
the dopesheet, no mesh attachments yet (Phase 5).

## Next up — Phase 5: Meshes, Weights & Deform (DESIGN.md §7)

1. **Mesh attachments in core + renderer** — Pixi `Mesh` with custom
   `MeshGeometry` from `meshVertices`/`meshTriangles`/`meshUVs` (types exist since
   Phase 1). Extend the viewport's `updateSlotMeshes` (it already handles per-frame
   vertex writes for regions).
2. **Mesh editing tool** — add/move vertices, earcut triangulation (add `earcut`
   or port the algorithm into `@core`).
3. **Weight painting UI** — writes the interleaved `[count, boneIndex, weight, …]`
   format; editor resolves id ↔ index via `skeleton.boneIndexMap`.
4. **Skinning step in the pipeline** — `computeMeshVertices` after IK
   (`EditorEngine.tick` currently: reset → apply → FK; add MESH step).
5. **`DeformTimeline`** — per-vertex offsets; `applyTimeline` has the no-op stub.
6. Extend smoke with a mesh-edit → deform-playback check.

Then: Phase 6 (IK) → 7 (persistence/export: IndexedDB autosave, FSAA,
migrations) → 8 (atlas/events/runtime polish).

## Environment / commands

```bash
npm install
npm run dev        # editor dev server → http://localhost:5173
npm test           # 101 unit tests (vitest)
npm run typecheck  # editor package
npm run build      # core+runtime via tsc -b
npm run build -w @limber/editor   # editor production bundle
npm run smoke              # Playwright E2E, headless (dev server must run)
HEADLESS=0 npm run smoke   # same, real GPU — run this when touching rendering
npm run docker:build && npm run docker:run   # nginx on :8080
```

## Gotchas learned the hard way (do not re-learn)

1. **ViewportCanvas Pixi lifecycle**: never create two `Application`s on one canvas.
   StrictMode double-invokes effects; the shared-canvas refcount manager
   (`acquireApp`/`releaseApp` in ViewportCanvas.tsx) is the fix — destroying an
   app whose `init()` hasn't resolved throws `_cancelResize`, and a real-GPU
   context loss freezes rendering silently. Don't "simplify" this away.
2. **Headless ≠ real GPU**: SwiftShader tolerates context loss; ANGLE/D3D11 does
   not. When touching rendering, verify in a HEADED browser — the smoke suite
   supports `HEADLESS=0 npm run smoke` for exactly this.
3. **Docker ignore patterns**: `*.tsbuildinfo` matches ONLY the root — stale
   buildinfos copied into the image made `tsc -b` delete freshly emitted
   `.d.ts` files. Use `**/*.tsbuildinfo`.
4. **Vite versions**: editor runs its own nested `vite@6.4.3`
   (`packages/editor/node_modules/vite`); the root-hoisted `vite@7.x` belongs to
   vitest/plugin peers. Both in one lockfile is normal, not corruption.
5. **Full `npm test` can transiently fail right after `npm install`** (transform
   cache cold + build writes). Rerun once before diagnosing.
6. **Windows shell here**: `grep -l | xargs sed` breaks (CRLF in paths) — use
   `find ... -exec sed ... {} +`.
7. The old empty folder `Documents/GitHub/Sprine Studio` was still locked by the
   old ZCode session at rename time — delete it manually if it still exists.
8. **CI/CD is ACTIVATED** (2026-10-05): repo [MikhaelBA/limber](https://github.com/MikhaelBA/limber)
   (public — Pages requires it on free plans), Pages serves
   https://mikhaelba.github.io/limber/ , image at `ghcr.io/mikhaelba/limber`
   (package defaults to PRIVATE — flip it public in package settings if you
   want anonymous `docker pull`). First-green-run bugs found & fixed: stale
   `@sprine/editor` in ci.yml, stale `@sprine/*` aliases in vitest.config.ts.
9. **A stale `vite` dev server from a previous session can still hold :5173**
   (new `npm run dev` dies with "Port 5173 is already in use"). It serves
   current files fine (vite reads from disk), but kill it if HMR acts weird.
10. **Pixi v8 API notes**: `new Texture({ resource })` does NOT exist — use
    `Texture.from(img, /* skipCache */ true)` so our registry owns the lifecycle;
    `MeshGeometry` exposes `positions`/`uvs` getters + `getBuffer('aPosition')`
    / `getBuffer('aUV')` for per-frame CPU updates.
11. **Packed colors are `0xRRGGBBAA`** — alpha is the LOW byte (`c & 0xff`), not
    the high byte. Two test bugs were written against the wrong end before it
    clicked.
12. **Playwright synthetic drops**: build the `File` in-page (canvas → toBlob),
    `new DataTransfer()` via `evaluateHandle`, add the file, then
    `locator.dispatchEvent('drop', { dataTransfer, bubbles: true })`. Real file
    dialogs are unavailable to automation.
