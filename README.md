# BoneByBone

BoneByBone is evolving from Limber while preserving its working skeletal editor.
The current plan is [docs/ROADMAP.md](docs/ROADMAP.md), with milestone evidence in
[docs/PROGRESS.md](docs/PROGRESS.md) and the target [product specification](docs/PRODUCT_SPEC.md).

Run `npm run check` for the foundation checks and `npm run test:e2e` for managed browser tests.

Open the self-contained [Fox Adventurer sample](examples/fox-adventurer/Fox-Adventurer.bbbproj)
to try layered sprites, bound meshes, cloth Deform, skins and hand IK.
[Sample guide and previews](examples/fox-adventurer/README.md).

[Import and package project fonts](docs/FONTS.md) for Scene/Game UI and Logic preview.

[Prepare and inspect native exports in Ship](docs/SHIP.md), including packed atlas pages,
typed native Logic inputs, measured CPU profiling and actionable Ship/Rig Doctor findings.
The Web runtime is independent of editor React; Unity/Cocos remain pending their engine
acceptance gates. The current CI runs unit/architecture checks, all managed development
browser suites, and the actual main production Ship workflow before publishing artifacts.
After `npm run build -w @limber/editor`, run `npm run test:e2e:production` for that shipping
bundle gate. Exact milestone counts and limitations are recorded in PROGRESS.md.

## Historical Limber documentation

The status below predates the BoneByBone roadmap. It is retained as implementation history, not current gate status.

A browser-based 2D skeletal animation editor (Spine clone). The architecture and phased plan live
in [DESIGN.md](./DESIGN.md).

## Status

**Phase 1 — Core Foundation: done.** **Phase 2 — Rigging Editor: done.** **Phase 3 — Animation & Timeline: done.**

- Monorepo (npm workspaces + TypeScript project references + Vitest)
- `@sprine/core`: full data model (skeleton/pose/animation types), stable topological sort,
  `Skeleton` with index baking + `rebuild()` (pose-preserving, weight-index remapping),
  allocation-free FK solver, versioned serialization with a migration runner
- `@sprine/core` animation: cubic-bezier solver (Newton + bisection, overshoot capable),
  binary-search keyframe interpolation, typed timeline application (bone props, slot color,
  attachment, draw order, events), `AnimationState` with crossfade weights, looping,
  queueing and seamless remainder carry-over
- `@sprine/editor` (React + Zustand + PixiJS v8 + Tailwind v4):
  - Viewport with bone gizmos, grid, pan (middle mouse) / zoom (wheel, cursor-anchored)
  - Bone tool (click to create root/child bones), select tool, click-picking by segment distance
  - Drag bones with world→parent-local conversion; one undo step per drag (continuous commands)
  - Hierarchy panel: tree, add/delete, drag-to-reparent (world-preserving, cycle-guarded)
  - Properties panel: name, transform (degrees UI / radians data), length, parent selector
  - Undo/redo everywhere (Command Pattern, `HistoryManager`) + shortcuts
    (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Delete / Space / V / B / Esc)
  - File: New / Open… / Save (versioned JSON via `@sprine/core` serialization)
  - Timeline: animation CRUD, dopesheet (bone rows + per-property keyframe rows), ruler
    scrubbing, transient 60fps playhead (no React re-renders), play/pause/stop, loop toggle,
    keyframe move (snapped to 30fps) / delete, auto-key on drag, "Key" button
  - Setup/Animate workflow: Animate mode shows the animated pose, drags and property edits
    write keyframes at the playhead (atomic undo)
- `@sprine/runtime`: `RuntimePlayer` stub — FK world transforms today; animation APIs land next
- Tests: 81 unit tests (core + commands/history/animation) + Playwright smoke test driving the
  real UI end-to-end (rigging, undo/redo, auto-key, playback)

## Workspace

| Package            | Purpose                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `packages/core`    | Framework-agnostic engine: data model, FK/IK, animation mixer, serialization. Pure TS, zero runtime dependencies. |
| `packages/editor`  | React + Zustand + PixiJS editor UI.                                                                               |
| `packages/runtime` | Lightweight player over `@sprine/core` for game engines.                                                          |

## Deployment

The editor ships as a static SPA inside an nginx image (multi-stage `Dockerfile`):

```bash
npm run docker:build   # build the production image (limber:latest, ~75MB)
npm run docker:run     # serve on http://localhost:8080
```

- Stage 1 (`node:22-alpine`): `npm ci` → `tsc -b` (core/runtime) → `vite build` (editor).
- Stage 2 (`nginx:1.27-alpine`): static files with gzip, immutable caching for
  hashed assets, and an SPA fallback (`docker/nginx.conf`).

CI/CD (`.github/workflows/ci.yml`) runs on every push/PR:

| Job      | What it does                                                                                              | When                                            |
| -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `test`   | typecheck → 81 unit tests → editor production build (artifact uploaded)                                   | every push & PR                                 |
| `docker` | build & **push** the image to `ghcr.io/<owner>/<repo>` (tags: branch, `vX.Y`, sha) with GHA layer caching | every push (push-to-registry on main/tags only) |
| `pages`  | **deploy** the static editor to GitHub Pages                                                              | pushes to `main`                                |

**To activate:** create a GitHub repo, push (`git remote add origin … && git push -u origin main`),
then in repo Settings → Pages set Source to **GitHub Actions**. No extra secrets needed — GHCR
auth uses the built-in `GITHUB_TOKEN`. Pull the deployed image with:

```bash
docker pull ghcr.io/<OWNER>/limber:main
```

## Commands

```bash
npm install     # install workspace dependencies
npm run dev     # start the editor dev server (Vite) → http://localhost:5173
npm test        # run the vitest suite (against package sources)
npm run build   # tsc -b — build core/runtime via project references
npm run smoke   # Playwright end-to-end smoke test (dev server must be running)
npm run typecheck  # typecheck the editor package
npm run clean   # remove build outputs
```
