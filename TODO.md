# Limber — Project Status & Task List

> Handoff document: read this + [DESIGN.md](./DESIGN.md) before continuing work.
> Last updated: 2026-10-05 (after the Sprine Studio → Limber rename & Docker/CI setup).

## Current status

| Area | State |
|---|---|
| Phase 1 — Core engine (data model, FK, serialization) | ✅ done |
| Phase 2 — Rigging editor (viewport, hierarchy, undo/redo) | ✅ done |
| Phase 3 — Animation & timeline (mixer, dopesheet, auto-key) | ✅ done |
| Docker (multi-stage, nginx, ~75MB) | ✅ done & verified |
| CI/CD (tests → GHCR image → GitHub Pages) | ✅ written, needs first push |
| Rename to Limber | ✅ done (folder is now `Documents/GitHub/Limber`) |

Verification baseline: **81 unit tests green**, typecheck green, editor production
build green, Playwright smoke (dev server) green, dockerized build browser-checked.

## Next up — Phase 4: Attachments, Draw Order & Skins (DESIGN.md §7)

Work top-to-bottom; keep each step tested before moving on:

1. **Texture registry + drag-and-drop** — drop image files onto the viewport
   (File API + `URL.createObjectURL` — NOT File System Access), store in an
   in-editor registry keyed by `textureId`, record in `document.assetManifest`.
2. **Attachment CRUD commands** — `AddAttachmentCommand`, `RemoveAttachmentCommand`
   (undoable, like bone commands). Region attachments: 4 corners + UVs (types exist
   in core since Phase 1).
3. **Slot rendering in the viewport** — for each slot in `pose.slotOrder`, draw its
   active region attachment (Pixi Sprite or textured Quad) using the bone's world
   matrix from `pose.worldMatrices`. Slots need add/remove UI (HierarchyPanel or a
   new panel section) + `AddSlotCommand`/`RemoveSlotCommand` bound to a bone.
4. **Draw order** — render in `pose.slotOrder` order; add up/down controls in the
   UI; `DrawOrderTimeline` already applies in core (applyTimeline) — needs editor
   keyframe insertion (a dopesheet row for draw order).
5. **Skins** — `SkinData` exists; add skin create/select UI, per-slot attachment
   override (`activeSkin` on SkeletonData).
6. **Slot color/alpha timelines** — `SlotColorTimeline` exists in core; add keying
   from a small color/alpha control.
7. Extend smoke.mjs with a drop-file → sprite-follows-bone check (use a tiny
   generated PNG; note IAB file dialogs are unsupported — use Playwright
   `evaluate` to synthesize a DataTransfer drop).

Then: Phase 5 (meshes/weights/deform) → 6 (IK) → 7 (persistence/export) →
8 (atlas/events/runtime polish). Details in DESIGN.md §7.

## Environment / commands

```bash
npm install
npm run dev        # editor dev server → http://localhost:5173
npm test           # 81 unit tests (vitest)
npm run typecheck  # editor package
npm run build      # core+runtime via tsc -b
npm run build -w @limber/editor   # editor production bundle
npm run smoke      # Playwright E2E (dev server must be running)
npm run docker:build && npm run docker:run   # nginx on :8080
```

## Gotchas learned the hard way (do not re-learn)

1. **ViewportCanvas Pixi lifecycle**: never create two `Application`s on one canvas.
   StrictMode double-invokes effects; the shared-canvas refcount manager
   (`acquireApp`/`releaseApp` in ViewportCanvas.tsx) is the fix — destroying an
   app whose `init()` hasn't resolved throws `_cancelResize`, and a real-GPU
   context loss freezes rendering silently. Don't "simplify" this away.
2. **Headless ≠ real GPU**: SwiftShader tolerates context loss; ANGLE/D3D11 does
   not. When touching rendering, verify in a HEADED browser
   (`headless: false` probe) — the user lost bone gizmos for this exact reason.
3. **Docker ignore patterns**: `*.tsbuildinfo` matches ONLY the root — stale
   buildinfos copied into the image made `tsc -b` delete freshly emitted
   `.d.ts` files. Use `**/*.tsbuildinfo`.
4. **Vite versions**: editor runs its own nested `vite@6.4.3`
   (`packages/editor/node_modules/vite`); the root-hoisted `vite@7.x` belongs to
   vitest/plugin peers. Both in one lockfile is normal, not corruption.
5. **Full `npm test` can transiently fail right after `npm install`** (transform
   cache cold + build writes). Rerun once before diagnosing.
6. Windows shell here: `grep -l | xargs sed` breaks (CRLF in paths) — use
   `find ... -exec sed ... {} +`.
7. The old empty folder `Documents/GitHub/Sprine Studio` was still locked by the
   old ZCode session at rename time — delete it manually if it still exists.
8. CI/CD activation checklist for the user: create GitHub repo `limber` →
   `git remote add origin … && git push -u origin main` → repo Settings →
   Pages → Source: **GitHub Actions**. GHCR needs no extra secrets.
