# Limber — Project Status & Task List

> Handoff document: read this + [DESIGN.md](./DESIGN.md) before continuing work.
> Last updated: 2026-10-06 (after Phase 8 chunk 1: texture atlas packing).

## Current status

| Area | State |
|---|---|
| Phase 1 — Core engine (data model, FK, serialization) | ✅ done |
| Phase 2 — Rigging editor (viewport, hierarchy, undo/redo) | ✅ done |
| Phase 3 — Animation & timeline (mixer, dopesheet, auto-key) | ✅ done |
| Phase 4 — Attachments, draw order & skins | ✅ done |
| Phase 5 — Meshes, weights & deform | ✅ done (chunks 1+2; runtime accessor pending) |
| Phase 6 — IK (solver + editor UI) | ✅ done |
| Phase 7 — Export & persistence: Spine JSON export + IndexedDB autosave | ✅ chunk 1 done |
| Events UI (keying, dopesheet row, dispatch) | ✅ done |
| QoL: playback speed, curve presets, slot blend modes | ✅ done |
| Phase 8 chunk 1 — Texture atlas packing (Spine bundle export) | ✅ done |
| Docker (multi-stage, nginx, ~75MB) | ✅ done & verified |
| CI/CD (tests → GHCR image → GitHub Pages) | ✅ done & verified on GitHub |
| CI/CD → VPS (nginx, rsync over SSH) | ✅ done & verified — http://129.121.148.115/ |
| Rename to Limber | ✅ done (folder is now `Documents/GitHub/Limber`) |

Roadmap agreed with the user (2026-10-06, after the Spine-docs gap review):
**A** mesh completion (this chunk) → **B** IK UI → **C** Spine-runtime JSON export +
IndexedDB autosave → **D** events UI → **E** QoL (bezier presets, loop/speed,
ghosting, blend modes) → **F** clipping/bbox/path/physics/audio/atlas/PSD/ghosting.
A–E landed 2026-10-06; F is in progress (atlas packing = F chunk 1 below).

Verification baseline: **169 unit tests green**, typecheck green (incl. the CI
`tsc -p packages/editor`), editor production build green, Playwright smoke green
**headless AND headed** (`HEADLESS=0`), including drop-image → sprite-follows-bone,
composite undo/redo, region→grid-mesh convert, **region→hull-mesh by clicking
4 points + closing on the first**, **animate-mode mesh-vertex drag → deform
keyframe**, **IK add → drag target → chain follows (angle asserted against the
live target)**, **IndexedDB autosave written after the debounce window**, and
**event keying via the timeline UI**.

## Phase 8 chunk 1 (atlas packing) — what landed (2026-10-06)

- **Core** (`core/serialization/atlasPack.ts`): shelf packer (tallest-first,
  padding gutter, power-of-two rounding, 8192 cap with clear errors, no
  rotation by design — mesh UVs are authored unrotated), `uniqueTexturePaths`
  (extension-stripped, collision-suffixed region names shared by JSON + atlas),
  and `buildAtlasText` (Spine 4.1 `.atlas` format: leading blank line,
  size/filter/pma header, `bounds:` regions). All pure — 8 golden tests.
- **`exportSpineJson(doc, texturePaths?)`**: optional region-name override so
  the bundle's JSON paths and atlas regions agree exactly.
- **Editor** (`editor/src/export/spineBundle.ts`): composites the packed
  atlas on a 2D canvas from the registry's texture blobs (`createImageBitmap`
  → drawImage → PNG); TopMenuBar "Export Spine Bundle" downloads
  `skeleton.json + atlas.png + atlas.txt`. No packed textures → JSON-only
  with a status note.
- Remaining Phase 8: clipping/bbox/path attachments, ghosting, audio, PSD
  import, runtime `getDeformedVertices`.

## Phase 7 chunk 2 (events + QoL) — what landed (2026-10-06)

- **Events**: `KeyEventCommand` / `DeleteEventKeyframeCommand`; timeline header
  has an event-name input + "⚡ Event" key button (Animate mode); violet
  "⚡ events" dopesheet row (click-select, Del deletes by time+name); during
  playback, fired events (engine.lastEvents) flash on the status bar. Event
  DEFINITIONS are collected from keyframes (Spine export emits them; no
  separate definitions editor yet).
- **QoL**: playback speed (×0.1–4, TimelinePanel, non-undoable engine setting);
  curve presets for the selected keyframe (linear/stepped/ease-in/out/in-out →
  `SetKeyframeCurveCommand`, bone/slotColor/deform kinds); slot blend modes
  (normal/add → `SetSlotBlendCommand`, additive rendering in the viewport,
  `blend` exported to Spine JSON; `SlotData.blendMode` optional — v2 additive).
- Ghosting/onion-skin deliberately deferred (needs an offset-pose evaluation
  pass in the viewport — listed under F).

## Phase 7 chunk 1 (export & persistence) — what landed (2026-10-06)

- **Spine-runtime JSON export** (`core/serialization/spineExport.ts` + "Export
  Spine JSON" in the top menu): 4.1-format skeleton. Conversions: ids→names,
  y-flip conjugation (y/rotation/shearX/shearY negate; degrees out), colors →
  "rrggbbaa" strings, meshes REORDERED hull-first (Spine `hull` is a count of
  the leading ring) with remapped triangles/uvs/weights, weighted meshes in
  the interleaved [count, bone, x, y, weight, …] form with per-influence
  bone-local coords (Mᵢ⁻¹·M_slot·v at setup), per-property timelines merged
  into packed translate/scale/shear tracks at the union of key times, bezier
  curves with value-space flips, draw-order as sequential slot-offset diffs,
  deform under `default.<slot>.<attachment>` with y-flipped offsets, event
  definitions collected from keyframes. Known approximations (documented in
  the file): shared pair curves use the y-flip only; held-value merging when
  a pair's key times mismatch; IK constraint names are generated (ik1, ik2…).
  Pair with a texture atlas at runtime (Phase 8 packs one).
- **IndexedDB autosave** (`editor/src/persistence/autosave.ts`): debounced
  1.5s writes of serializeDocument + the texture SOURCE BLOBS (registry keeps
  them per textureId; `loadBlob` restores under the ORIGINAL id so
  attachments resolve). "Restore autosave" in the top menu (enabled when a
  record exists; startup status hint); New clears the record. Restore is
  pixel-complete — no re-dropping images.

## Phase 6 (IK) — what landed (2026-10-06)

- **Core solver** (`core/skeleton/IKSolver.ts` — NEW): analytic 1/2-bone IK run
  AFTER FK. Law-of-cosines solve in world space; `bendDirection` flips the
  elbow; `mix` blends shortest-arc toward the pre-IK pose; targets beyond reach
  clamp into the reachable annulus (fully-extended chain). Writes LOCAL
  rotations (bone2's relative to bone1's SOLVED angle — the stale-matrix trap)
  and re-runs FK per constraint so later constraints/skinning see the result.
  Assumes no shear/positive scale along the chain (documented). L1 = current
  distance between the two origins; L2 = second bone's `length`.
  `EditorEngine.tick`: reset → apply → FK → IK → skinning.
  Skeleton validation now also enforces: 2-bone chains must be parent→child.
- **Editor commands** (`editor/src/commands/ikCommands.ts` — NEW):
  `AddIKConstraintCommand` (chain = selected bone + its parent; auto-creates a
  target bone at the chain tip's SETUP world position, parented into the chain
  root's parent; one undo removes bone + constraint; lazy unique naming),
  `RemoveIKConstraintCommand` (constraint only — target stays), `SetIKPropsCommand`
  (mix/bendDirection/target; rebuild only on target swap). RemoveBoneCommand's
  existing IK cleanup covers deletions.
- **UI**: IK section in the hierarchy (chain ⇢ target rows; ＋ uses the selected
  bone), per-bone IK editor in Properties (mix, bend cw/ccw flip, target select,
  delete, "＋ Add IK" when none exist), and an orange tip→target reach line +
  target ring in the viewport for constraints touching the selection. Target
  bones drag like any bone (setup drag = MoveBone; animate drag = auto-key) —
  the chain follows live through tick.
- **Not yet**: IK timeline keys (animatable mix/bend — needs a new timeline
  kind), softness, pole vectors. Solver ignores them (stored, unsolved).

## Phase 5 chunk 2 — what landed (2026-10-06)

- **Polygon hull meshes**: with the Mesh tool over a slot showing a REGION, clicks
  place hull vertices (bone-local); clicking the first vertex again or Enter closes
  → `CreateHullMeshCommand` converts the region to a mesh (region kept, unassigned;
  undo restores). Esc cancels mid-draw (capture-phase key handler swallows the
  global tool-switch shortcut). In-progress hull previews as a polyline + rubber
  band to the cursor.
- **Triangulation = cdt2d** (dep in @limber/editor, typed via
  `src/types/cdt2d.d.ts`): constrained Delaunay over hull ring AND interior
  Steiner points — earcut can't do Steiner points. `triangulateMesh(vertices,
  hull)` is the single entry point; degenerate input → `[]` (cdt2d never throws).
  `AttachmentData.meshHull` (format **v2**, additive migration — v1 docs load as
  all-hull) stores boundary indices in walk order; absent = every vertex is hull.
  Grid meshes now store their perimeter ring too.
- **Interior vertex editing**: double-click inside the hull adds a Steiner vertex
  (UV by barycentric lookup in the containing triangle; point-in-hull ray-cast
  guard), Alt+click deletes a vertex (min 3 kept; hull indices remapped; the
  vertex's weight entry dropped). Vertex-count changes invalidate deform offsets
  → deform timelines are stripped and restored ATOMICALLY with the topology edit
  (incl. redo).
- **Deform keying (§5.6 pattern)**: in Animate mode, Mesh-tool vertex drags run
  `AutoKeyDeformCommand` — each pointermove re-keys the attachment's FULL offsets
  array at the playhead (base captured at grab = interpolated pose). Dopesheet
  gained a per-slot "◈ deform" row (emerald diamonds, click-select, Del deletes)
  for the mesh the slot currently shows.
- **Weight brush**: radius + strength + mode (add/set/smooth) in the toolbar
  (weights tool); dabs hit every vertex inside the radius with smoothstep falloff;
  smooth relaxes toward the dedup'd neighbor average (`meshAdjacency` from
  triangles); brush circle follows the cursor.
- **Core fixes found on the way**: weight entries with `count: 0` (the paint
  baseline, "rigid to slot bone") are now VALID (`validateAttachmentWeights`,
  `remapAttachmentWeights` accept 0) and the weighted skinning walk falls back
  RIGID to the slot bone for them (previously: validation threw on rebuild after
  painting, and the walker collapsed such vertices to the origin).

## Phase 5 chunk 1 — what landed (2026-10-06)

- **Skinning in core** (`core/skeleton/skinning.ts`): pipeline step 5 after FK —
  `updateSkinning` writes WORLD-space vertices into the new `pose.attachments`
  cache (`{verts, deform, deformed}` per attachmentId, allocated by
  createPose/rebuild). Rigid attachments transform by the slot bone; weighted
  attachments do linear blend skinning `Σ wᵢ·Mᵢ·(v+deform)` — blending
  transformed POINTS is exact in 2D. `Skeleton.attachmentById` baked with the
  other maps. The renderer now reads the cache for regions AND meshes (no more
  client-side transform).
- **DeformTimeline** applies in core: linear per-component interpolation,
  `null` offsets = setup mesh (zeros), crossfade-safe alpha blending,
  resetPose clears the deform cache every frame.
- **Grid meshes** (`editor/commands/meshCommands.ts`): `AddMeshCommand` builds
  a regular N×N-cell lattice (3×3 verts default) from a texture — same
  triangle pattern as regions; `SetMeshVerticesCommand` (continuous drag,
  bone-local); `PaintWeightsCommand` (continuous stroke; blends vertex weight
  toward the selected bone vs the slot bone, creating the interleaved
  `[count, boneIndex, weight, …]` array on first paint; full weight collapses
  to a single rigid entry).
- **Tools**: `◈ Mesh` (M) drags vertices of the selected slot's mesh;
  `⚖ Weights` (W) paints toward the selected bone — handles colored by
  influence, live update through the skinning step. "Grid mesh" button in the
  slot properties panel.

### Phase 5 remaining (next chunks)

1. ~~Arbitrary polygon meshes~~ ✅ chunk 2 (cdt2d, hull + Steiner vertices).
2. ~~Deform keying UI + dopesheet row~~ ✅ chunk 2.
3. ~~Weight brush UX~~ ✅ chunk 2.
4. Runtime package consumer: `getDeformedVertices` off the new cache.
5. Nice-to-haves: Trace (auto-hull from image alpha), linked meshes,
   deform keyframe dragging in the dopesheet.

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
npm test           # 169 unit tests (vitest)
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
   `.d.ts` files. Use `**/*.tsbuildinfo`. SAME TRAP LOCALLY: deleting only
   `dist/` while keeping `packages/*/tsconfig.tsbuildinfo` made the next
   `tsc -b` silently delete most core `.d.ts` files (runtime then failed with
   "no exported member"). Clean rebuild = delete BOTH dist and tsbuildinfo.
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
9. **VPS deployment** (2026-10-05): `ssh blue` → hossein@129.121.148.115
   (Ubuntu 26.04). nginx serves `/var/www/limber` (SPA fallback, immutable
   cache for /assets, config in /etc/nginx/sites-available/limber); the
   workflow's `Deploy to VPS` job rsyncs `dist/` there (env `production`)
   after tests, using secrets VPS_HOST/VPS_USER/VPS_SSH_KEY/VPS_KNOWN_HOSTS
   and a dedicated deploy key (`~/.ssh/limber_ci_ed25519` locally; public key
   in the server's authorized_keys). Site: http://129.121.148.115/ — no
   domain/HTTPS yet (add an A record + `certbot --nginx` when ready).
   NOTE: **rsync must exist on the VPS** (first deploy failed with
   "remote command not found" until `apt install rsync`). GitHub runner
   queues can lag several minutes under load — a queued run is NOT a failure.
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
13. **`npx tsc -b` does NOT typecheck the editor package** — it only builds the
    referenced projects (core, runtime). CI runs `npm run typecheck`
    (= `tsc -p packages/editor`, INCLUDES tests). Three pushes went red before
    this clicked. Before every push: `npm run typecheck` AND `npm test`.
14. **`page.mouse` coordinates are PAGE-relative; camera.x/y are CANVAS-relative** —
    include `canvas.getBoundingClientRect()` when bridging world→screen for
    tests (see `__worldToScreen`), and assert against LIVE positions
    (`__ikTarget0`) rather than assumed setup poses.
