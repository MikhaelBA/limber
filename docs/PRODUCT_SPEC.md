# BoneByBone product specification v0.1

Source: user-supplied BoneByBone_Product_Development_Specification_v0.1.docx, 6 October 2026.

The text below preserves the source requirements and prompt examples. Accepted migration decisions and the actual delivery status live in ADRs and ROADMAP.md. Prompt examples are reference material, not evidence that a phase is complete.

PRODUCT / UX / ENGINEERING / RUNTIME
BoneByBone
Product Development Specification
A browser-based real-time 2D animation authoring system for game characters, game UI, and animated game graphics — designed to move cleanly from artist to Unity and Cocos Creator.
PRODUCT THESISMake the shortest reliable path from layered game artwork to performant, interactive runtime animation. BoneByBone should automate repetitive technical setup without taking control away from expert animators.
Version 0.1 • 6 October 2026
Document purpose
This document is the working product contract for BoneByBone. It translates competitive research and current animation-tool workflows into an implementable architecture, user experience, runtime strategy, phased roadmap, quality gates, and Codex prompt pack. It is deliberately opinionated: when a feature conflicts with clarity, deterministic runtime behavior, or engine integration, those constraints win.
How to use it
Product/design decisions in Sections 1–8 should be treated as constraints unless an explicit architecture decision record (ADR) changes them.
Engineering phases in Section 11 are sequential gates. A later phase must not compensate for an unstable earlier core.
The Codex prompts in Section 12 are starting prompts. They assume the repository contains this specification or an equivalent /docs/PRODUCT_SPEC.md.
Research references use [S#] markers and are listed at the end. Official documentation is preferred over secondary commentary.
Executive decisions
Decision | Specification
Product name | BoneByBone (working product name; trademark/domain clearance still required).
Category | Real-time 2D game animation authoring, not generic motion design.
Primary content | Game UI, skeletal characters, FX/props — all on one scene/animation model.
Primary engines | Unity first and Cocos Creator second; Web runtime is required for editor preview.
Editor delivery | Browser-based, local-first, installable as a PWA later; cloud optional.
Renderer | WebGL2 production backend behind a renderer abstraction; WebGPU is a later optional backend.
Core philosophy | Progressive disclosure: beginner-friendly defaults, professional depth underneath.
Runtime philosophy | Own file format + own runtimes; source and runtime formats are separate.
Commercial direction | Editor proprietary; strongly consider MIT/open runtimes and no per-game runtime royalty.

1. Product definition
   1.1 One-sentence positioning
   POSITIONINGBoneByBone is the easiest way to build performant 2D animation that ships directly into a game — from characters and HUDs to menus, rewards, props, and interactive animated components.
   1.2 What BoneByBone is
   BoneByBone is a browser-based authoring environment where an artist can import layered artwork, construct a scene or rig, animate properties, define reusable logic, validate performance, and export a compact runtime asset for Unity or Cocos Creator. The same evaluation engine powers the editor preview and the shipping runtimes, reducing “looks different in engine” failure modes.
   1.3 What BoneByBone is not
   A 1:1 clone of Spine, Rive, After Effects, Toon Boom, or a game engine editor.
   A full vector-illustration package in v1.
   A video compositor or frame-by-frame paint package.
   A 3D animation system.
   An AI-first product that replaces animation craft.
   A cloud-only editor that requires user artwork to be uploaded.
   1.4 Target users
   Persona | Primary jobs | Failure today | BoneByBone promise
   2D game animator | Rig/animate characters and props | Tool depth + engine handoff friction | Fast setup, deep animation, direct engine preview/export
   UI / motion designer | Animate menus, HUD, rewards, interactive components | AE export is baked; engine rebuild is manual | Author responsive runtime UI motion + logic in one asset
   Technical artist | Define constraints, performance budgets, export rules | Glue scripts and inconsistent assets | Validation, profiling, reusable templates, deterministic export
   Indie developer | Integrate animation without custom pipeline work | Runtime/version/API complexity | Small stable API, importer, open runtime, predictable asset format
   1.5 North-star workflow
   ARTWORK → BUILD → ANIMATE → LOGIC → SHIPPSD/PNG scene motion states validatefonts rig curves data atlas UI events input Unity / Cocos
   The UX must optimize this entire path. A feature that is powerful in isolation but makes this flow slower should be challenged.
2. Research synthesis: what to copy, what to avoid
   2.1 Spine: professional skeletal-animation depth
   Spine’s current guide remains the strongest reference for game-focused skeletal authoring. Its model cleanly separates bones, slots and attachments; adds meshes and weighted deformation; supports skins, IK/path/transform/physics constraints, events, dopesheet/graph editing, runtime metrics, texture packing, PSD import, and export to JSON/binary runtime data. [S1–S9]
   Spine concept | Keep in BoneByBone | Improve / reinterpret
   Setup vs Animate modes | Separate structural edits from keyframed motion | Use Build and Animate workspaces; show mode consequences clearly.
   Bones → slots → attachments | Retain conceptual separation internally | Use friendly labels in default UI; expose technical object types in Advanced view.
   Meshes + weights | Essential for character quality | One-click mesh + auto-weight first; topology/weight tools progressively disclosed.
   Dopesheet + graph | Essential for professional timing/easing | Simple timeline first; graph opens only when needed and stays synchronized.
   IK / constraints | Essential | Offer semantic actions such as Pin Hand / Pin Foot, with full constraint inspector behind them.
   Skins / linked meshes | Essential for variants | Extend the idea into reusable game components/variants.
   Events / points / boxes | Excellent game primitives | Make game meaning explicit: event, socket, hitbox, hurtbox, spawn point.
   Metrics / atlas packing | Strong runtime discipline | Move this into a dedicated Ship workspace with platform budgets and fix suggestions.
   Version-coupled exports | Understandable but costly for teams | Design runtime format/versioning for backward compatibility and migrations where feasible.
   2.2 Rive: interaction, responsive UI, data, runtimes
   Rive is the benchmark for interactive real-time graphics: state machines, components, dynamic text, responsive layouts, data binding and production runtimes are first-class. Its game positioning now explicitly targets menus, HUDs and 2D game graphics, so BoneByBone cannot differentiate on “interactive animation” alone. [S10–S13]
   Rive strength | BoneByBone response
   State machine bridges designer → runtime | Build Logic as a core workspace, not an export afterthought.
   Responsive layouts / components | Make anchors, safe area, 9-slice and reusable UI components first-class.
   Dynamic data/text | Provide typed parameters, runtime bindings and localization stress tests.
   Open runtimes | Strongly prefer open, royalty-free runtimes to reduce lock-in anxiety.
   Broad apps/web/games scope | Stay game-specific: engine concepts, asset budgets, sockets, hitboxes, atlases, mobile profiling.
   2.3 LoongBones: proof that browser skeletal editing is already real
   LoongBones demonstrates that a browser-based skeletal editor can already offer meshes, weights, IK, constraints, physics and multi-engine export. Therefore “Spine in a browser” is not a product moat. BoneByBone must win on workflow quality, game UI integration, engine handoff, diagnostics and product polish rather than on browser delivery alone. [S14]
   2.4 Unity and Cocos Creator: meet the engines where they already are
   Cocos Creator’s documentation explicitly positions its built-in animation panel as appropriate for less complex UI animation and recommends external skeletal tools for more complex character/nested animation. It also exposes animation clips, events, property animation and state-machine concepts. This is a natural integration gap for BoneByBone. [S15–S18]
   Unity provides a native 2D skeletal package, extensible asset import through ScriptedImporter, and multiple UI paths. BoneByBone should not recreate Unity’s editor workflow; it should import a finished, engine-ready animation asset with a small runtime API and inspector tooling. [S19–S21]
   2.5 Competitive conclusion
   THE GAPDo not compete on a checklist of bones, meshes or curves. Compete on the complete game workflow: layered art → fast setup → animation → interaction → engine-ready asset → measurable runtime performance.
3. Information architecture and core UX
   3.1 Four workspaces
   Workspace | User question | Primary tools | What stays hidden by default
   BUILD | What is this asset made of? | Hierarchy, assets, transforms, layout, bones, slots, meshes, masks, components | Timeline details, graph curves, state graph internals
   ANIMATE | How does it move? | Timeline, dopesheet, curves, keying, events, deform, draw order | Export details, advanced runtime profiling
   LOGIC | How does it react? | Parameters, states, transitions, data binding, interaction preview | Low-level render/export settings
   SHIP | Will it run correctly in my game? | Validation, profiler, atlas, platform preset, export, runtime test | Authoring clutter
   3.2 Project templates
   Character — preconfigures orthographic artboard, skeleton hierarchy, character events and mobile performance budget.
   Game UI — preconfigures responsive artboard, safe-area presets, text/data placeholders, 9-slice and pointer states.
   FX / Prop — lightweight project with sprite/image animation, masks, events and optional bones.
   Blank — no assumptions.
   3.3 Persistent shell
   The core layout is a professional four-pane editor: top command/mode bar; left hierarchy/assets; central viewport; right inspector; contextual bottom panel. All panels are resizable. The bottom panel becomes timeline/graph in Animate, state graph in Logic, and diagnostics/export in Ship. Selection stays synchronized between hierarchy and viewport.
   Figure 1. BoneByBone editor concept. Dark neutral surfaces keep art dominant; semantic accent colors are reserved for interaction and animation states.
   3.4 Progressive disclosure rules
   Default actions use artist language. Example: “Pin Foot” creates/configures a two-bone IK constraint; Advanced exposes solver parameters.
   An object’s common 5–8 properties appear first. Advanced sections are collapsed and searchable.
   Timeline starts as a clean row-based editor. Dopesheet filters and curve graph appear on demand.
   Complex dialogs are replaced with inline previews where possible. Modal dialogs are reserved for destructive, import/export or security-sensitive flows.
   Every automation has a reversible result. Auto mesh, auto weights and optimization never destroy the previous state without undo history.
   3.5 Input and shortcut philosophy
   Action | Default
   Select | V
   Pan | Space + drag / middle drag
   Move | W
   Rotate | E
   Scale | R
   Bone tool | B
   Mesh edit | M
   Key selected property | K
   Play / pause | Space when viewport not panning
   Frame selection | F
   Command palette | Ctrl/Cmd + K
   Save | Ctrl/Cmd + S
   Undo / redo | Ctrl/Cmd + Z / Shift+Ctrl/Cmd+Z
   Shortcuts should be rebindable after v1 beta. Avoid stealing established browser shortcuts unless the editor has a clear focused-canvas context.
4. Visual design system
   4.1 Brand direction
   BoneByBone should feel like a precise creative instrument, not a playful skeleton-themed app. The name is memorable; the interface should avoid skulls, cartoon bones, medical imagery and Halloween associations. A minimal joint/segment motif can appear in the logo and loading states.
   4.2 Logo direction
   Wordmark: BoneByBone, with typographic emphasis on the repeated “Bone”.
   Symbol: two articulated segments joined by a circular joint, optionally forming an abstract B/B or keyframe diamond.
   Use the symbol at small sizes; use the full wordmark in onboarding, site header and export/package branding.
   Do not finalize a public logo before trademark/domain clearance.
   4.3 Palette
   Token | Hex | Role | Text guidance
   Ink | #0D0F13 | App background / darkest field | Bone Ivory, secondary text
   Surface 1 | #151821 | Panels | Bone Ivory / secondary
   Surface 2 | #1C2130 | Viewport chrome / inputs | Bone Ivory / secondary
   Surface 3 | #252B3A | Hover / selected neutral | Bone Ivory
   Border | #343B4C | Dividers / control edges | Not text
   Bone Ivory | #F4F1EA | Primary text | Use on dark surfaces
   Marrow Violet | #8B7CFF | Primary action / active mode | Use Ink text on filled button
   Rig Teal | #39D7C1 | Rig/selection/valid link | Use Ink text when filled
   Key Amber | #F7C85B | Keyframes / animation emphasis | Use Ink text when filled
   Error | #FF6B7A | Blocking validation | Pair with icon + label
   Success | #5ED39B | Passing checks / connected | Pair with icon + label
   Info | #65B7FF | Info / diagnostics | Pair with icon + label
   4.4 Accessibility constraints
   Target WCAG 2.2 AA for the web application. Normal text should meet 4.5:1 contrast; meaningful UI boundaries, state indicators and graphical objects should meet at least 3:1 against adjacent colors. Never encode keyframe/constraint/error state using hue alone — combine color with shape, iconography, line style or label. [S26]
   4.5 Typography and sizing
   Element | Recommendation
   UI font | Inter or equivalent neutral variable sans; 12–14 px effective body size.
   Numeric/code fields | Monospace numerals for time, transforms, IDs, profiling numbers.
   Panel headers | 11–12 px, semibold, uppercase only for small structural labels.
   Inspector labels | 12–13 px; values 12–13 px; 28–32 px minimum control height.
   Touch target | Desktop-first; keep critical targets at least ~28 px and avoid tiny unlabeled icons.
   Focus | Highly visible focus ring; keyboard navigation must never be ambiguous.
5. Unified content model
   5.1 Scene graph
   Project└─ Artboard / Scene ├─ Group ├─ Image ├─ NineSliceImage ├─ Text ├─ Shape (limited v1 primitives) ├─ Bone ├─ Slot │ └─ Attachment (Region / Mesh / Mask / Box / Point) ├─ ComponentInstance └─ RuntimeMarker (Hitbox / Hurtbox / Socket / SpawnPoint)
   Every persisted object receives a stable ID. User-visible hierarchy paths are labels, never primary references. Renaming a node must not break tracks, transitions or engine bindings.
   5.2 Transform model
   The core must support 2D translation, rotation, scale and pivot from the start. Shear can be implemented with character rigging but should not pollute common UI controls. World transforms must be deterministic and testable independent of React or the renderer.
   5.3 Animation tracks
   Track class | Examples
   Transform | x/y, rotation, scale, shear, pivot where valid
   Visual | opacity, tint, sprite/attachment swap, draw order, mask properties
   UI/layout | anchor offsets, size, layout gaps, progress/value, component properties
   Text/data | string binding reference, numeric value, style token where supported
   Rig | bone transforms, IK/constraint mix, deform vertices
   Events | named event + typed payload + optional audio/runtime cue
   Custom | typed component property exposed to runtime
   5.4 Timeline behavior
   Auto-key is explicit and highly visible; structural edits never accidentally become animation keys.
   Overview rows summarize descendant keys, following the useful dopesheet pattern used by Spine. [S4]
   Stepped, linear and cubic Bezier interpolation are mandatory; curve presets are convenience, not stored as magic behavior.
   Multi-key selection supports move, duplicate, scale-in-time and value editing.
   Graph and dopesheet share the same underlying track/key objects — never duplicate data models.
   5.5 Undo/redo transaction model
   All editor mutations go through commands/transactions. Continuous drags coalesce into one undo step; imports and auto-rig actions may be composite transactions. Do not snapshot the complete project on every pointer move. Undo/redo must be deterministic, serializable for debugging, and covered by regression tests.
6. Character animation specification
   6.1 Rig hierarchy and attachments
   Model bones, slots and attachments separately, following the proven separation used by Spine: bones carry transforms; slots own draw order/color and choose one visible attachment; attachments carry renderable or runtime geometry. [S2–S3]
   6.2 Rigging UX
   Create bone by drag; child creation defaults to parent selection.
   Human template can place canonical shoulder/elbow/wrist/hip/knee/ankle guides without forcing a naming convention.
   Mirror creates opposite-side bones and can mirror weights/IK with a preview.
   “Pin Hand” / “Pin Foot” creates a target + appropriate IK constraint. Advanced inspector exposes mix, bend, stretch/softness where supported.
   Bone length remains meaningful for solver behavior and auto-weight heuristics, consistent with professional rigging practice. [S2]
   6.3 Meshes and weights
   Mesh editing requires vertices, edges, triangulation, UV mapping and weighted bone influences. Auto mesh and auto weight are first-class one-click actions; manual topology and weight painting are the correction path. Spine’s weight workflow and metrics show why influence count matters for runtime cost, so BoneByBone should expose influence limits and pruning directly. [S3, S5]
   Operation | Default UX | Advanced UX
   Generate mesh | One click with Quality slider | Vertex/edge tools, trace/hull, triangulation view
   Bind bones | Suggest nearby relevant bones | Manual bind list
   Auto weight | One click | Algorithm options only if proven useful
   Paint weights | Smooth/erase/add brush | Per-bone lock, numerical weights
   Prune | Platform preset suggests max influences | Threshold + max influences
   Linked mesh | Variant action from attachment menu | Explicit source link and deform inheritance
   6.4 Skins and variants
   Provide skin/variant sets that can swap attachments while preserving animation. Skin-specific bones and constraints may be added later if the core model supports conditional activation. Linked/shared mesh data should prevent duplicated topology across outfits.
   6.5 Constraints
   Constraint | v1 priority | UX
   IK | P0 | Semantic pin action + advanced solver properties
   Transform | P1 | Follow/copy transform with mix controls
   Path | P1 | Follow spline for tails, ropes, UI motion paths
   Physics / secondary | P1 late beta | Simple inertia/spring presets before detailed coefficients
   Slider/animation-driven | Post-v1 candidate | Useful but not required for initial market fit
   6.6 Game semantics
   Treat runtime markers as typed primitives: Hitbox, Hurtbox, Trigger, Socket, SpawnPoint and generic Point. Geometry can reuse attachment infrastructure internally, but the editor should show the user the game meaning, not “bounding box attachment”. This is a deliberate improvement over generic animation terminology. [S8]
7. Game UI animation specification
   7.1 UI primitives
   Image and 9-slice image
   Text with runtime data placeholders
   Group/container
   Mask / clip
   Reusable component + instance
   Basic shape primitives for panels/highlights
   Anchor/pivot and responsive layout constraints
   Safe-area preview presets
   Pointer/focus interaction states
   7.2 Responsive layout
   The UI model must not assume a fixed 1920×1080 canvas. Support anchor presets, pivot, min/max sizing, stretch/fixed behavior, aspect constraints and device safe areas. Use familiar concepts that map cleanly to Unity RectTransform/Cocos UI layout without copying their exact implementation. Rive’s responsive layouts and Cocos’s multi-resolution UI model validate this requirement. [S10, S15]
   7.3 Nine-slice
   9-slice must be available in the first UI-authoring milestone because production game interfaces depend on resizable panels/buttons without corner distortion. Atlas/export metadata must preserve borders exactly.
   7.4 Text and localization
   Runtime-updatable text values via typed binding names.
   Preview test values: shortest, expected, long, extreme numeric value.
   Font fallback strategy and bundled-font licensing warnings.
   RTL/bidirectional layout correctness is a product requirement, not a later “internationalization fix”.
   Localization stress mode that expands strings and flags clipping/overflow.
   7.5 Reusable UI components
   PrimaryButton├─ Visual tree├─ Exposed properties: label, icon, enabled, selected├─ States: Normal / Hover / Pressed / Disabled / Selected└─ Animation/state logic
   Instances inherit component structure and logic but may override explicitly exposed properties. Versioning rules must prevent silent destructive changes across dozens of instances.
8. Logic, interaction and data binding
   8.1 Typed parameters
   Type | Examples | Runtime setter
   Bool | enabled, grounded, selected | SetBool(name, value)
   Float | speed, healthPct, progress | SetFloat(name, value)
   Int | coins, level, combo | SetInt(name, value)
   String | username, rewardLabel | SetString(name, value)
   Trigger | attack, open, celebrate | Fire(name)
   8.2 State machine
   State machines belong in the core product because they reduce the design-to-code gap for both UI and characters. States can play animations, nested state graphs can come later, and transitions use typed conditions, exit-time rules and blend durations. The graph must remain deterministic and inspectable at runtime.
   Idle ── speed > 0.1 ──▶ Walk ── speed > 4 ──▶ Run ▲ │ └──── speed <= 0.1 ─────┘Any State ── attack(trigger) ──▶ Attack ── exit ──▶ previous locomotion
   8.3 Data binding
   Binding should connect runtime data to exposed component properties without requiring an animator to write code. Keep v1 intentionally small: one-way runtime→view bindings plus state-machine conditions. Two-way form-style bindings are unnecessary for the initial game use case.
   8.4 Events
   Events use stable names and typed payloads. The editor provides common templates (Footstep, AttackHit, SpawnProjectile, SFX, Haptic, UIConfirm) but stores generic event data so teams are not locked into predefined semantics. Spine and Cocos both validate frame/event workflows as core runtime features. [S7, S17]
9. Ship workspace: validation, optimization, export
   9.1 Rig Doctor and Ship Doctor
   DIAGNOSTIC PRINCIPLEThe product should answer “is this asset safe to ship?” before the developer discovers the problem in-engine.
   Check | Example message | Action
   Broken refs | Animation track targets deleted node | Repair target / remove track
   Rig | Hand has no IK target; unweighted vertices detected | Focus / auto-fix
   Mesh cost | Hair mesh has 612 vertices and 6 influences | Optimize / prune weights
   Texture | Atlas spills to second page | Repack / show offenders
   Clip cost | Large clipped mesh may increase fragment/CPU cost | Focus clipped geometry
   UI overflow | German test string clips button label | Open localization preview
   Runtime | Unsupported feature for selected engine version | Show compatibility matrix
   9.2 Metrics
   Display the metrics that correlate with real runtime work: bones, constraints, slots/nodes, vertices, weighted vertex transforms, triangles, clipping geometry, active tracks, draw calls, atlas pages, approximate texture memory and measured frame/update timings. Spine’s Metrics view is a strong precedent; BoneByBone should make the information actionable with budgets and fixes. [S6]
   9.3 Platform presets
   Preset | Initial philosophy
   Mobile low | Conservative influences, texture size and draw-call warnings; prioritize predictable mid/low device performance.
   Mobile high | Higher mesh/texture budgets while retaining draw-call discipline.
   Desktop | Relaxed texture/mesh budgets; keep pathological warnings.
   Web | Texture/memory conscious, browser runtime constraints visible.
   Custom | Team-defined thresholds stored in project/workspace settings.
   9.4 Texture atlas
   Atlas packing is a shipping feature, not an external utility. Support padding, trim/whitespace stripping, rotation option, scale, max page size, premultiplied-alpha metadata where relevant, 9-slice preservation and deterministic packing. Packing should run in a worker and produce a visual page preview. Spine’s texture packing guidance shows the runtime benefit of reducing texture switches. [S9]
   9.5 Export philosophy
   BoneByBone must own its authoring and runtime schemas. Do not depend on Spine project/runtime formats. Spine’s license and version coupling reinforce the value of independent formats and compatibility discipline. [S9, S27]
10. Technical architecture
    Figure 2. Editor shell, framework-free core, renderer and worker tasks are separated so the runtime model is portable.
    10.1 Repository layout
    bonebybone/├─ apps/│ └─ editor-web/├─ packages/│ ├─ model/ # IDs, scene graph, schemas│ ├─ math/ # vec2/mat3/transform math│ ├─ animation-core/ # tracks, keyframes, blending, evaluator│ ├─ constraints/ # IK/transform/path/physics│ ├─ mesh/ # topology, triangulation, weights│ ├─ renderer/ # renderer abstraction + WebGL implementation│ ├─ editor-state/ # selection, commands, history, tool state│ ├─ project-format/ # source schema + migrations│ ├─ runtime-format/ # compact shipping representation│ ├─ import-psd/│ ├─ atlas/│ ├─ validator/│ ├─ runtime-web/│ └─ ui/ # shared React UI primitives only├─ runtimes/│ ├─ unity/│ └─ cocos/├─ fixtures/├─ docs/└─ tools/
    10.2 Hard architecture boundaries
    No animation math, skinning, state-machine evaluation or serialization logic inside React components.
    Core packages must run in tests/Node without a DOM where technically reasonable.
    Renderer consumes evaluated scene state; it does not own authoring truth.
    Editor commands mutate the model through explicit transactions; components do not mutate deep objects ad hoc.
    Unity/Cocos runtimes implement the same behavioral specification, but do not share platform-specific rendering code.
    File schema changes require migration tests and a documented schema version bump.
    10.3 Browser stack
    Use TypeScript and React for the editor shell. Use PixiJS/WebGL2 initially behind a renderer adapter; PixiJS currently recommends WebGL for production while its WebGPU backend is still described as maturing. Use Web Workers for PSD parsing, topology/auto-weight work, atlas packing, validation and export. OPFS is appropriate for local autosave/cache because the browser File System API explicitly provides an origin-private area optimized for performance. [S22–S25]
    10.4 Persistence
    Working session ├─ in-memory immutable-ish model + command history ├─ OPFS autosave snapshots / journal └─ IndexedDB metadata (recent projects, preferences, recovery index)User project └─ .bbbproj (portable authoring package)Shipping output └─ .bbb (optimized runtime package)
    10.5 Source vs runtime format
    .bbbproj authoring | .bbb runtime
    Editor metadata | No editor-only metadata
    Guides, selections, workspace state | Evaluated structural data only
    Editable topology/weights | Compact topology/weights
    Original asset references / embeds | Packed atlas/font references
    Full names/comments | Stable IDs + required names
    Migration-friendly JSON/chunks initially | Binary/flat representation after profiling
    10.6 Evaluation order
    setup/default values→ sample animation tracks→ blend active animations→ evaluate state machine outputs→ solve constraints→ compute world transforms→ apply mesh skinning/deform→ resolve UI layout + bound values→ determine draw order/masks→ renderer submission
    This order must be written as a formal runtime specification with golden fixtures. Any intentional exception should be explicit, because inconsistent evaluation order across Web, Unity and Cocos is a high-risk class of bugs.
    10.7 Performance targets
    Target | Gate
    Editor interaction | Pointer/transform drag should generally stay within one 60 Hz frame on recommended desktop hardware.
    UI response | Non-render commands should feel immediate; target <50 ms for common property edits.
    Heavy work | Any operation likely to exceed a frame (atlas, PSD, auto-weight, export) runs off main UI thread or is chunked.
    Runtime parity | Web/Unity/Cocos fixture poses match within defined float tolerance.
    Project load | No O(N²) traversal over common hierarchy/track operations; instrument large fixtures early.
    10.8 Benchmark fixtures
    Fixture | Minimum contents
    Simple character | 25 bones, ~500 weighted vertices, 3 animations
    Standard character | 60 bones, ~2,500 weighted vertices, 5 constraints, 10 animations
    Heavy character | 120 bones, ~10,000 weighted vertices, clipping + deform
    UI screen | 100 nodes, 12 components, dynamic text, 9-slice, masks
    Heavy UI | 500 nodes, nested components, 20 state transitions, localization stress
    Crowd | 25 concurrently animated standard/light characters
    10.9 Security and privacy
    Local projects never upload artwork by default.
    Cloud sync is a separate opt-in service boundary with clear project status.
    AI features, if introduced, must explicitly state when content leaves the device and provide a no-upload path for core work.
    Validate untrusted project/archive contents; guard decompression sizes and path traversal.
    Engine importers must treat asset data as untrusted input and fail safely.
11. Development phases and gates
    Figure 3. The sequence intentionally validates the editor/core before adding engine runtimes or cloud/commercial features.
    Phase 0 — Foundation & product constitution
    Goal: establish the monorepo, coding standards, architecture boundaries, test harnesses and ADR process before feature code.
    Deliverables
    pnpm workspace + TypeScript strict mode + lint/format/test/typecheck
    apps/editor-web boots with a minimal shell
    core packages have no accidental React dependency
    Vitest/unit harness + Playwright smoke harness
    performance fixture folder and deterministic test seed policy
    /docs/architecture.md, /docs/runtime-spec.md, /docs/adr/
    Acceptance criteria
    CI passes on clean checkout
    a sample core package is testable without browser DOM
    one ADR documents renderer choice and one documents source/runtime format split
    no “temporary” global mutable store
    ARCHITECTURE GATEDo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 1 — Editor shell, model, commands & local recovery
    Goal: make a stable project that can create nodes, edit properties, undo/redo and recover locally.
    Deliverables
    stable IDs + scene graph schema
    hierarchy, viewport placeholder, inspector, bottom panel shell
    selection model and command/transaction history
    create/delete/reparent/rename/group operations
    OPFS autosave + recovery index
    new/open/save-as .bbbproj prototype
    Acceptance criteria
    1000 random command undo/redo round-trip test
    rename/reparent never breaks references
    closing/reopening recovers last autosave
    large hierarchy operations remain responsive
    CORE EDITOR GATEDo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 2 — Renderer, transforms, selection & gizmos
    Goal: a fast 2D viewport with deterministic world transforms and production interaction basics.
    Deliverables
    PixiJS/WebGL2 adapter
    image nodes, groups, opacity/tint, draw order
    camera pan/zoom/frame selection
    move/rotate/scale gizmos, snapping, pivot
    selection outlines and multi-select
    renderer metrics hooks
    Acceptance criteria
    golden transform tests including negative scale/rotation hierarchy
    drag feels 60fps on standard fixture
    render output matches stored screenshot fixtures within tolerance
    React re-renders are not driving per-frame animation
    VIEWPORT GATEDo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 3 — Animation core, timeline, dopesheet, curves & events
    Goal: first Motion Alpha: create, edit, preview and persist high-quality property animation.
    Deliverables
    clips, tracks, keys, interpolation
    stepped/linear/cubic Bezier curves
    auto-key + explicit key button
    timeline zoom/pan/playhead, key selection/move/duplicate/time-scale
    dopesheet overview rows + filtering
    graph editor synchronized with same tracks
    loop/playback controls and generic events
    Acceptance criteria
    60fps playback on Standard fixture
    curve interpolation golden tests
    editing graph never creates a second source of truth
    save/load is bitwise/deterministically equivalent where designed
    event ordering at identical timestamps is defined/tested
    MOTION ALPHADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 4 — UI authoring
    Goal: make BoneByBone useful for real game UI before character complexity dominates the product.
    Deliverables
    anchors/pivot/size model
    responsive constraints + safe-area/device presets
    9-slice image node
    text node + runtime placeholder values
    mask/clip node
    component + instance v1
    UI template projects and localization stress preview
    Acceptance criteria
    same UI fixture adapts across phone/tablet aspect presets without manual rebuild
    9-slice borders survive animation/export
    component edits propagate without corrupting overrides
    RTL test fixture lays out correctly for supported text path
    UI ALPHADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 5 — Character rigging core
    Goal: build the structural skeletal model with a fast artist workflow.
    Deliverables
    bones, slots, region attachments
    bone tool and hierarchy visualization
    setup/build pose vs animation pose separation
    attachment swapping and draw order
    skin/variant v1
    points/sockets + typed runtime markers
    human rig helper + mirror
    Acceptance criteria
    character setup changes cannot silently key animation
    skin swap preserves animation
    socket world transform is deterministic
    hierarchy and slot/draw-order tests cover edge cases
    RIG ALPHADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 6 — Meshes, deformation & weights
    Goal: reach professional character quality with measurable runtime cost.
    Deliverables
    mesh topology editor, hull/vertices/edges
    triangulation and UVs
    bind bones
    auto weights in worker
    weight paint/smooth/prune + max influences
    linked/shared mesh data
    deform animation tracks where necessary
    Acceptance criteria
    no invalid triangulation reaches runtime
    weights normalize deterministically
    max-influence prune has golden tests
    large auto-weight operation never freezes UI
    Standard/Heavy fixtures report vertex-transform cost
    DEFORM ALPHADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 7 — Constraints & secondary motion
    Goal: add the rigging behaviors required for production game animation.
    Deliverables
    2-bone IK first
    semantic Pin Hand/Foot action
    transform constraint
    path constraint
    physics/secondary motion only after solver spec is stable
    constraint ordering UI and runtime spec
    Acceptance criteria
    solver numerical tests and degenerate-case tests
    web preview remains deterministic under fixed timestep
    constraint order is serialized explicitly
    advanced parameters are hidden from beginner path unless expanded
    CHARACTER ALPHADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 8 — Logic mode
    Goal: attach runtime behavior to animations and UI without requiring code for common transitions.
    Deliverables
    typed parameters
    states + transitions + Any State
    blend durations / interruption rules
    triggers and conditions
    one-way data binding to exposed properties
    interaction preview: pointer/focus/test inputs
    debug overlay showing active state/transition/parameter changes
    Acceptance criteria
    same graph produces same sequence under recorded input stream
    transition priority and interruption are documented/tested
    invalid cycles/conditions produce actionable validation
    logic can be disabled without changing raw animation assets
    INTERACTIVE ALPHADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 9 — Runtime package, web runtime, atlas, profiler & Ship Doctor
    Goal: freeze a first shipping contract before engine integrations multiply compatibility cost.
    Deliverables
    runtime schema + schema version
    web runtime independent of editor React
    atlas packer worker
    Ship/Rig Doctor validation engine
    platform performance budgets
    runtime profiler and compatibility report
    debug JSON plus compact .bbb representation
    Acceptance criteria
    export→load→play round trip for all fixtures
    runtime package contains no editor-only data
    new runtime reads at least defined previous schema fixture
    all validation errors have code + severity + object reference + user-facing remedy
    RUNTIME ALPHADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 10 — Unity runtime & importer
    Goal: one-drop integration for Unity projects.
    Deliverables
    Unity package structure + asmdefs
    ScriptedImporter for .bbb
    BoneByBoneAsset + Player API
    world renderer
    UGUI renderer first; UI Toolkit extension later
    events, parameters, skins, sockets
    sample scenes + profiler markers
    Acceptance criteria
    importing sample .bbb requires no manual conversion
    Play/SetBool/SetFloat/Fire/SetString APIs work
    render/pose parity with web fixtures
    package works in target Unity LTS/Unity 6 matrix defined at implementation time
    reimport preserves user component references
    UNITY BETADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 11 — Cocos Creator runtime & extension
    Goal: API-parity integration with Cocos Creator for mobile/HTML5 teams.
    Deliverables
    TypeScript runtime/extension
    asset importer/loader for .bbb
    component renderer integrated with Cocos node/UI model
    events, parameters, skins, sockets
    editor inspector helpers + sample scenes
    API naming matched to Unity conceptually
    Acceptance criteria
    web/editor/Cocos pose parity fixtures
    asset can be dropped and played with minimal setup
    state parameters/events match Unity behavioral spec
    mobile/web build samples pass target matrix
    COCOS BETADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 12 — Production hardening & public beta
    Goal: make the tool trustworthy enough for external teams to use on real projects.
    Deliverables
    PSD import with structured layer mapping
    crash-safe autosave/recovery
    project migrations and corruption diagnostics
    Rig/Ship Doctor fix actions
    onboarding sample projects
    shortcut/search polish, accessibility pass
    telemetry/crash reporting opt-in
    docs + engine quickstarts + migration policy
    Acceptance criteria
    beta teams can complete character + UI workflows without developer intervention
    no known data-loss bug
    recovery tested with forced browser/process termination
    WCAG keyboard/focus/contrast audit passes target
    performance regressions blocked by benchmark CI
    PUBLIC BETADo not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
    Phase 13 — Commercial v1
    Goal: ship a supportable product, not merely a feature-complete editor.
    Deliverables
    account/licensing only if required by business model
    optional cloud sync/version history
    team libraries later than local reliability
    billing + entitlement isolated from local authoring
    release channels + changelog + migration tooling
    support diagnostics bundle without artwork by default
    Acceptance criteria
    offline/local editor behavior remains clearly defined
    runtime assets continue to function independent of subscription status under chosen license
    rollback/migration support documented
    support can reproduce issues from sanitized diagnostic bundles
    V1Do not start the next dependency-heavy phase until these acceptance criteria are green in CI and the representative fixture can be used end-to-end.
12. Codex implementation prompt pack
    Use the master prompt at the start of a fresh Codex workstream. Then use the phase prompt when the previous gate is green. The prompts deliberately require repository inspection and tests before implementation; they should not be shortened into “build X” requests.
    CODEX PROMPT — MASTER ENGINEERING CONSTITUTION
    You are the lead engineer implementing BoneByBone, a browser-based real-time 2D animation authoring system for game UI, skeletal characters, and animated game graphics.Before changing code:1. Read /docs/PRODUCT_SPEC.md, /docs/architecture.md, /docs/runtime-spec.md and existing ADRs.2. Inspect the repository and identify the exact packages affected.3. Write a concise implementation plan and list invariants/tests that must remain true.Non-negotiable architecture rules:- React is the editor shell, never the animation/runtime math engine.- Scene/model, animation evaluation, constraints, mesh skinning, state logic and serialization must remain framework independent.- Renderer consumes evaluated state; it does not own authoring truth.- All persistent references use stable IDs, never hierarchy paths.- Editor mutations go through transactions/commands so undo/redo is deterministic.- Source (.bbbproj) and runtime (.bbb) schemas are separate.- Any schema change requires a version bump when appropriate, migration coverage and fixture tests.- Expensive work must not block the UI thread.- Do not copy proprietary Spine/Rive implementation details or formats. Implement documented/general animation concepts independently.Engineering rules:- TypeScript strict; no `any` without a written local justification.- Prefer small explicit modules and pure functions for math/evaluation.- Add numerical/golden tests before or alongside solver/interpolation/serialization work.- Do not hide failing tests, weaken assertions, or silently change fixtures to make a test pass.- Avoid scope creep. If you discover a desirable feature outside the current phase, add it to /docs/backlog.md instead of implementing it.- Add performance instrumentation to hot paths before optimizing blindly.- Keep public APIs documented and minimize churn.Completion:Run format, lint, typecheck, unit tests, relevant integration/E2E tests and benchmark smoke tests. Summarize files changed, architectural decisions, verification performed, known limitations and exact next gate.
    Phase 0 — Repository foundation
    CODEX PROMPT — PHASE 0 — REPOSITORY FOUNDATION
    Implement Phase 0 of BoneByBone only.Create the pnpm TypeScript monorepo described in PRODUCT_SPEC. Establish apps/editor-web and the initial packages for model, math, animation-core, renderer, editor-state, project-format, runtime-format, validator and ui. The editor may render only a shell at this phase.Required outcomes:- TypeScript strict mode everywhere with project references where useful.- Shared lint/format/test/typecheck scripts at root.- Vitest unit harness and Playwright editor smoke test.- CI configuration that runs on a clean checkout.- Architecture dependency guard: core packages cannot import React/editor-web.- ADRs for renderer choice, state management boundary, ID strategy and source/runtime format split.- Fixture framework with deterministic random seed helper.Do not implement animation features yet. Keep dependencies minimal. After implementation run the full checks and report the exact workspace graph and any architectural concern before Phase 1.
    Phase 1 — Model, command history, persistence
    CODEX PROMPT — PHASE 1 — MODEL, COMMAND HISTORY, PERSISTENCE
    Implement Phase 1. Build the minimum stable authoring model and editor shell.Add stable project/artboard/node IDs, Group and Image nodes, parent/child ordering, common transform defaults and schema validation. Implement editor selection and a command/transaction system for create, delete, duplicate, rename, reparent, reorder and property edits. Continuous pointer-style property edits must be mergeable into one undo step.Build the visible shell: top workspace bar, left hierarchy/assets region, center viewport placeholder, right inspector and contextual bottom panel. Implement New/Open/Save As for the prototype .bbbproj representation plus OPFS autosave/recovery metadata.Tests must include reference stability under rename/reparent, randomized undo/redo round trips, invalid-cycle rejection, schema parse failures, autosave recovery, and a hierarchy stress fixture.Do not add animation tracks or renderer-specific truth to the model. Finish only when save/load and undo/redo are trustworthy.
    Phase 2 — Viewport and transforms
    CODEX PROMPT — PHASE 2 — VIEWPORT AND TRANSFORMS
    Implement Phase 2: the production viewport boundary.Integrate PixiJS through packages/renderer behind a BoneByBone renderer interface. Implement deterministic local/world transform math in packages/math/model, image rendering, hierarchy order, opacity/tint, camera pan/zoom and frame-selection. Add viewport selection and move/rotate/scale gizmos with snapping and pivot editing.Important: React must not perform per-frame scene evaluation. The renderer receives compact evaluated render items or a documented adapter input.Add transform golden tests covering nested rotation, non-uniform and negative scale, pivots, reparent-with/without-preserve-world-transform and floating-point tolerance. Add screenshot regression fixtures and frame timing instrumentation. Test multi-selection and undo coalescing.Do not begin keyframe animation. If the viewport cannot stay responsive on the Standard fixture, profile and resolve the architecture problem before moving on.
    Phase 3 — Animation core and editors
    CODEX PROMPT — PHASE 3 — ANIMATION CORE AND EDITORS
    Implement BoneByBone Motion Alpha.Create Clip, Track and Keyframe models plus deterministic sampling for stepped, linear and cubic Bezier interpolation. Add playback clock, looping, explicit/auto keying and generic events with deterministic same-time ordering.Build the bottom timeline/dopesheet: zoom/pan, playhead, property rows, descendant overview rows, box selection, move/duplicate/delete, time scaling and filters. Build a curve editor that manipulates the same underlying keys; never maintain separate curve data.Add golden tests for interpolation, boundary sampling, looping, multiple simultaneous tracks, event ordering and serialization. Add an E2E test: import two images, animate transforms/opacity, edit easing, save, reload and verify the same preview state.Keep blend/state-machine work out of scope until Phase 8.
    Phase 4 — Game UI authoring
    CODEX PROMPT — PHASE 4 — GAME UI AUTHORING
    Implement the Game UI authoring milestone without turning BoneByBone into a generic web layout tool.Add UI-aware nodes/properties: anchors, pivot, size, stretch/fixed constraints, min/max bounds, safe-area presets, NineSliceImage, Text, Mask and Component/ComponentInstance v1. Add artboard/device preview presets and localization stress values. Design text interfaces so shaping/fallback/RTL can be implemented correctly; do not hard-code Latin assumptions.Component instances must inherit structure and permit only explicit overrides. Define the override/migration behavior in an ADR before coding it.Acceptance tests: one reward popup adapts to at least four aspect ratios; 9-slice preserves border pixels; nested component edits propagate correctly; mask nesting has a defined supported limit; RTL fixture displays in the correct direction using the selected text stack.Do not implement full CSS/Flexbox compatibility. Implement the smallest game-oriented responsive model that is deterministic across runtimes.
    Phase 5 — Skeleton model and rigging UX
    CODEX PROMPT — PHASE 5 — SKELETON MODEL AND RIGGING UX
    Implement the character rigging core independently of Spine file formats.Add Bone, Slot and RegionAttachment model types with setup-pose transforms, draw order, slot color/opacity and attachment switching. Build the bone creation tool, bone/slot hierarchy visualization, setup/build pose behavior, attachment assignment, skin/variant v1, Point/Socket and typed RuntimeMarker nodes.Add artist accelerators: human guide template, mirror operation and semantic Pin Hand/Pin Foot command skeleton (the actual IK solver comes in Phase 7). Ensure setup edits cannot accidentally create animation keys.Tests: hierarchy/world pose math, slot draw order, attachment switching, skin activation, mirrored transform correctness, socket world transform and save/load. Update runtime-spec with the exact bone/slot/attachment evaluation semantics.
    Phase 6 — Meshes and weights
    CODEX PROMPT — PHASE 6 — MESHES AND WEIGHTS
    Implement production mesh deformation in packages/mesh and integrate it into Build/Animate.Support mesh vertices/edges/hull, deterministic triangulation, UVs, bone binding, weighted influences, CPU skinning reference implementation, linked/shared meshes and deform tracks. Build auto-mesh and auto-weight as worker jobs with progress/cancel. Add weight paint, smooth, normalize and prune/max-influence tools.Treat numerical correctness as higher priority than UI polish. Create golden fixtures with expected deformed vertex positions and property-based tests that weights remain normalized within tolerance. Reject/repair invalid topology explicitly; never let NaN/degenerate data silently reach runtime.Instrument weighted vertex-transform counts and worker durations. The UI must remain interactive during Heavy fixture auto-weight work.
    Phase 7 — Constraints
    CODEX PROMPT — PHASE 7 — CONSTRAINTS
    Implement constraints in a solver pipeline with explicit ordering.Start with robust 1/2-bone IK required by Pin Hand/Pin Foot. Then implement transform constraint and path constraint. Add secondary/physics motion only after deterministic fixed-step semantics are specified and tested.Constraint inputs/outputs must be independent of the renderer. Write numerical tests for reachable/unreachable IK targets, bend direction, zero/near-zero bone lengths, mirrored hierarchies, mix values and stretch/softness behavior actually supported. Add cycle/invalid-order validation.UX: default inspector shows semantic controls; an Advanced disclosure shows solver-specific values. Serialize constraint order explicitly. Do not copy Spine equations/source code — implement from standard math references and our own runtime specification.
    Phase 8 — Logic workspace
    CODEX PROMPT — PHASE 8 — LOGIC WORKSPACE
    Implement Logic mode as a deterministic runtime feature shared by UI and characters.Add typed parameters (bool/float/int/string/trigger), state graphs, transitions, conditions, exit behavior, blend duration/interruption rules and Any State. Add one-way runtime-to-property data binding for explicitly exposed properties. Add an interaction preview where pointer/focus/test controls can drive parameters. Build a debug overlay that shows active state, transition progress and recent parameter/event changes.First write a concise state-machine semantics document with transition priority, trigger consumption, interruption and same-frame ordering. Then implement against it.Tests must replay recorded input streams and produce identical state/pose outputs. Invalid graphs must produce validator errors rather than undefined behavior.
    Phase 9 — Runtime/export/Ship workspace
    CODEX PROMPT — PHASE 9 — RUNTIME/EXPORT/SHIP WORKSPACE
    Freeze Runtime Alpha.Define the first versioned .bbb runtime schema separate from .bbbproj. Implement export compilation, a framework-independent Web runtime, atlas packing worker, validation/Rig Doctor/Ship Doctor and profiler metrics. The runtime package must exclude editor-only metadata and support deterministic load/play of all current fixtures.Provide human-readable debug JSON and a compact representation; do not prematurely optimize into an opaque binary until benchmark evidence justifies the format. Add schema migration/backward-reader fixtures now.Ship workspace must show blocking errors, warnings, platform budgets, draw calls/atlas pages, bones/constraints/vertices/weighted transforms/tracks/clipping and measured update/render timing when available. Each diagnostic has code, severity, object ID, explanation and remedy/fix action when safe.Gate: export → load in Web runtime → play/logic/event parity for UI and character fixtures.
    Phase 10 — Unity package
    CODEX PROMPT — PHASE 10 — UNITY PACKAGE
    Implement the BoneByBone Unity integration against Runtime Alpha.Create a versioned Unity package with asmdefs, editor/runtime split and a ScriptedImporter for .bbb. Import into BoneByBoneAsset plus required texture/material/sub-assets without forcing manual conversion. Implement BoneByBonePlayer, world renderer and UGUI renderer first; document UI Toolkit as a later adapter unless the current architecture makes it low risk.Public API must include Play, Stop, SetBool/Float/Int/String, Fire trigger, event subscription, skin/attachment selection and socket lookup. Add Unity profiler markers.Build automated parity fixtures comparing sampled poses/events/state outputs against Web reference data. Test reimport behavior so user-authored scene component references are preserved. Define the supported Unity version matrix from current official/LTS releases at implementation time rather than hard-coding today’s matrix.
    Phase 11 — Cocos Creator integration
    CODEX PROMPT — PHASE 11 — COCOS CREATOR INTEGRATION
    Implement the BoneByBone Cocos Creator runtime/extension using the same behavioral runtime specification as Web and Unity.Create .bbb asset loading/import support, a BoneByBone component, renderer integration appropriate to Cocos scene/UI nodes, parameters/events/skins/sockets and inspector helpers. Keep the public concepts and method names as parallel to Unity as language conventions allow.Use the existing TypeScript runtime logic where it is genuinely portable, but do not force browser/editor dependencies into Cocos. Add build samples for mobile and web targets.Run parity fixtures from the same canonical runtime test data. Any unavoidable platform difference must be documented as a compatibility entry, not hidden.
    Phase 12 — Public beta hardening
    CODEX PROMPT — PHASE 12 — PUBLIC BETA HARDENING
    Prepare BoneByBone for external production use.Implement layered PSD import with a documented mapping/tagging strategy, import preview and non-destructive reimport rules. Harden OPFS autosave/recovery with forced-termination tests. Add project migrations, corruption diagnostics, Rig/Ship Doctor fix actions, onboarding sample projects, command palette/search, shortcut polish and accessibility audit fixes.Create concise docs for: 15-minute UI workflow, 15-minute character workflow, Unity quickstart, Cocos quickstart, file/version compatibility and troubleshooting. Add opt-in crash/diagnostic reporting that excludes artwork by default.Run benchmark CI, migration corpus tests, accessibility keyboard/focus checks and a data-loss test suite. Do not open public beta while any known reproducible project-loss bug remains.
    Phase 13 — Commercial v1
    CODEX PROMPT — PHASE 13 — COMMERCIAL V1
    Turn the beta into a supportable commercial product without compromising local-first authoring.Implement only the commercial services validated by beta demand: authentication/entitlement if needed, optional cloud sync/version history, billing and release channels. Keep these systems isolated so local authoring and already-exported runtime assets have a clearly documented behavior when offline or unsubscribed.Create privacy/retention documentation, export/runtime licensing text with legal review, a sanitized support diagnostics bundle and release/migration tooling. Do not add team collaboration merely because subscription infrastructure exists; ship it only if user research validates it.Before v1, run upgrade/rollback drills, entitlement outage tests, migration from every supported beta schema and engine package compatibility tests.
    12.1 Model/reasoning guidance for Codex work
    Use a high-reasoning coding configuration for architecture changes, transform/constraint math, serialization/migrations, state-machine semantics, importers and runtime parity debugging. Routine component styling, copy changes and isolated UI polish can use a faster standard configuration once contracts and tests are fixed. Never trade numerical/runtime verification for speed.
13. Runtime integration contracts
    13.1 Common conceptual API
    // conceptual cross-engine surfaceplayer.Play("attack", fade: 0.12)player.SetBool("grounded", true)player.SetFloat("speed", 3.8)player.SetInt("coins", 1250)player.SetString("username", "Miki")player.Fire("open")player.OnEvent("AttackHit", callback)player.SetSkin("armor_red")player.GetSocket("weapon_r")
    Language conventions can differ, but the semantic contract should remain recognizable across Unity, Cocos and Web. This lowers documentation cost and enables shared fixtures.
    13.2 Unity contract
    .bbb imported through ScriptedImporter into a stable BoneByBoneAsset.
    World-space renderer and UGUI renderer share the runtime evaluator but use engine-appropriate draw paths.
    Runtime asset reimport must not destroy scene references/components.
    Expose profiler markers for update, state evaluation, constraints, skinning and render preparation.
    Debug inspector shows active animation/state, parameters, recent events and performance metrics.
    13.3 Cocos contract
    TypeScript package/extension loads .bbb and maps texture/font assets cleanly into Creator projects.
    Component can render in the appropriate world/UI context and exposes the same conceptual controls.
    Integrate with Cocos events and node hierarchy without requiring users to rebuild the animation graph.
    Provide mobile/web sample projects and automated build smoke tests.
14. File format and compatibility policy
    14.1 Schema identifiers
    { "format": "bonebybone-project", "schemaVersion": "0.4.0", "generator": { "app": "BoneByBone", "version": "0.4.2" }, "projectId": "...", "artboards": [ ... ]}
    14.2 Compatibility rules
    Major schema changes may require explicit migration; minor schema additions should be safely ignorable/defaultable when feasible.
    Editor preserves an original backup before destructive migration.
    Runtime loader reports unsupported major versions with a clear required minimum/maximum.
    Prefer newer runtimes reading older .bbb assets so engine package updates do not routinely require re-export.
    Every released schema has immutable test fixtures retained in the compatibility corpus.
    14.3 Determinism
    Sort or explicitly store all order-sensitive collections. Avoid relying on JavaScript object enumeration, hash-map order or engine-specific floating-point quirks. Define tolerances for cross-runtime transform/vertex comparison. State-machine and event ordering must be formally specified.
15. Quality strategy
    15.1 Test pyramid
    Layer | Examples
    Pure unit | matrix/transform, Bezier, track sampling, ID/reference, validation rules
    Numerical golden | IK, constraints, skinning, deform, layout, animation blending
    Property-based | weight normalization, undo/redo reversibility, migration invariants
    Serialization corpus | all historical .bbbproj/.bbb schema fixtures
    Visual regression | viewport pose, masks, 9-slice, UI aspect presets
    E2E | create → animate → logic → export → runtime preview
    Engine parity | Web vs Unity vs Cocos sampled poses/events/state outputs
    Performance | fixture benchmark thresholds in CI / scheduled build
    15.2 Definition of done for a feature
    User-visible behavior documented.
    Unit/integration tests cover success + failure cases.
    Undo/redo behavior defined if authoring state changes.
    Serialization/migration impact reviewed.
    Validation/diagnostics added for invalid persisted state.
    Keyboard/focus/contrast reviewed for UI.
    Performance instrumentation checked for hot-path features.
    Web/runtime parity considered before marking complete.
16. Scope control: v1 vs later
    Ship for v1 | Defer until evidence
    Raster image workflows + PSD | Full vector authoring comparable to Rive/Illustrator
    Skeletal rigging + meshes/weights | Frame-by-frame painting
    IK/transform/path + restrained physics | 3D
    Game UI responsive layout + 9-slice + text | Video compositing
    State machines + data binding | Marketplace
    Unity + Cocos + Web preview runtime | Unreal/Godot until demand is measured
    Local-first save/recovery | Real-time multiplayer editing
    Rig/Ship Doctor | Generative “animate everything” AI as headline feature
    PSD import | Plugin scripting ecosystem before core APIs stabilize
17. Commercial and licensing direction
    Commercial design should reinforce adoption rather than punish learning. A “free to learn/create, pay to ship or collaborate” structure is market-tested by Rive, but BoneByBone should validate willingness-to-pay with beta users before locking exact tiers. Rive currently advertises free creation and a $9/seat/month Cadet tier for shipping; this is a useful benchmark, not a price to copy blindly. [S12]
    Tier hypothesis | Value
    Free | Local projects, full core authoring, web preview, learning/sample use.
    Indie | Engine export/runtime packaging, commercial use, advanced optimization; target price research around $8–12/month or annual equivalent.
    Studio | Shared libraries/version history/cloud/team controls when those features exist.
    Enterprise | Security, support, org controls, custom deployment/runtime support only if demand appears.
    17.1 Runtime licensing recommendation
    Strongly consider MIT/open-source runtimes with the editor remaining proprietary. This improves developer trust, integration debugging and long-term asset viability. Rive’s official runtimes are MIT licensed, showing that an open-runtime/commercial-editor model is viable. [S13] Legal counsel should review the final editor EULA, runtime license and third-party dependencies before release.
    17.2 Name clearance
    BONEBYBONE NAMEUse BoneByBone as the working product name throughout development. Preliminary web searching did not identify an obvious same-category product conflict, but that is not trademark clearance. Before public branding, perform trademark, company-name, domain and major social-handle searches in target markets.
18. Beta research plan and success metrics
    18.1 Recruit
    Recruit 12–20 external testers across three groups: professional 2D game animators, UI/motion designers working in engines, and indie/technical developers responsible for integration. Include both Spine/Rive users and people currently animating directly in Unity/Cocos.
    18.2 Benchmark tasks
    Task | Success signal
    Reward popup | Import assets → responsive layout → animate → button states → engine preview in <30 minutes for first-time user.
    Humanoid rig | Layered art → rig → IK → mesh/weights → idle/walk/attack → socket/events without tutorial dependency.
    Runtime handoff | Developer imports .bbb and connects parameters/events without writing adapter code.
    Performance fix | User finds and resolves an intentionally over-budget mesh/atlas issue from Ship Doctor.
    Recovery | Browser/process crash loses no more than the documented autosave interval and recovery is obvious.
    18.3 Product metrics
    Time to first successful animated export.
    Percentage of projects exported without blocking validation error.
    Engine import success rate without documentation lookup.
    Undo/recovery/data-loss incident rate.
    Median editor frame time on benchmark fixtures.
    Weekly projects that include both Animate and Logic usage.
    30-day retention among users who successfully ship one engine asset.
19. Open decisions before implementation expands
    Decision | Recommended default | When to revisit
    State/store library | Choose a small store suited to command-based editor state; keep core model separate. | After Phase 1 stress test.
    PixiJS depth vs custom WebGL | Use PixiJS through adapter initially. | If batching/mesh/mask requirements show hard limitations.
    Text shaping library | Select based on RTL/font/runtime portability tests. | Before Phase 4 implementation.
    Source container | ZIP-like .bbbproj with structured JSON/chunks. | Before external beta / large asset profiling.
    Runtime binary | Delay; ship debug/structured representation first. | When load size/time data justifies binary compiler.
    Physics solver | Minimal deterministic 2D secondary motion. | After character beta validates use cases.
    Cloud | None required for core product. | Only after local beta establishes retention and collaboration demand.
    AI assistance | Quiet automation only. | After core workflow metrics identify repeated manual pain.
20. Research references
    [S1] Spine User Guide — https://en.esotericsoftware.com/spine-user-guide
    [S2] Spine — Bones — https://en.esotericsoftware.com/spine-bones
    [S3] Spine — Mesh attachments — https://en.esotericsoftware.com/spine-meshes
    [S4] Spine — Dopesheet view — https://en.esotericsoftware.com/spine-dopesheet
    [S5] Spine — Weights view — https://en.esotericsoftware.com/spine-weights
    [S6] Spine — Metrics view — https://en.esotericsoftware.com/spine-metrics
    [S7] Spine — Events — https://en.esotericsoftware.com/spine-events
    [S8] Spine — Bounding boxes / point attachments — https://en.esotericsoftware.com/spine-bounding-boxes
    [S9] Spine — Export & texture packing — https://en.esotericsoftware.com/spine-export/
    [S10] Rive — Features — https://rive.app/features
    [S11] Rive — Game UI — https://rive.app/game-ui
    [S12] Rive — Pricing — https://rive.app/pricing
    [S13] Rive runtime overview / MIT licensing — https://github.com/rive-app/help-center/blob/master/runtimes/overview.md
    [S14] LoongBones — https://www.loongbones.app/
    [S15] Cocos Creator — Animation System — https://docs.cocos.com/creator/3.8/manual/en/animation/
    [S16] Cocos Creator — Animation Panel — https://docs.cocos.com/creator/3.8/manual/en/animation/animation-editor.html
    [S17] Cocos Creator — Controlling Animation with Scripts — https://docs.cocos.com/creator/3.8/manual/en/animation/animation-component.html
    [S18] Cocos Creator — Marionette Animation System — https://docs.cocos.com/creator/3.8/manual/en/animation/marionette/index.html
    [S19] Unity Manual — 2D Animation package — https://docs.unity3d.com/Manual/com.unity.2d.animation.html
    [S20] Unity Scripting API — ScriptedImporter — https://docs.unity3d.com/ScriptReference/AssetImporters.ScriptedImporter.html
    [S21] Unity Manual — UI Toolkit — https://docs.unity3d.com/Manual/UIElements.html
    [S22] MDN — WebGL2RenderingContext — https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext
    [S23] MDN — OffscreenCanvas — https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
    [S24] MDN — File System API / OPFS — https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
    [S25] PixiJS — Renderers — https://pixijs.com/8.x/guides/components/renderers
    [S26] W3C — WCAG 2.2 Non-text Contrast — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
    [S27] Spine Editor License — https://esotericsoftware.com/spine-editor-license
    Appendix A — Proposed UI tokens
    --bbb-bg: #0D0F13;--bbb-surface-1: #151821;--bbb-surface-2: #1C2130;--bbb-surface-3: #252B3A;--bbb-border: #343B4C;--bbb-text: #F4F1EA;--bbb-text-secondary: #B8C0CC;--bbb-text-muted: #838D9F;--bbb-primary: #8B7CFF;--bbb-primary-hover: #A59AFF;--bbb-rig: #39D7C1;--bbb-key: #F7C85B;--bbb-error: #FF6B7A;--bbb-success: #5ED39B;--bbb-info: #65B7FF;--bbb-bone-overlay: #54C7EC;--bbb-ik-target: #F5A45D;
    Appendix B — First public demo definition
    The first demo worth showing publicly should be a single project that proves the product thesis rather than a disconnected feature reel:
    Open a layered reward-screen PSD and reconstruct the UI.
    Animate the popup with curves, dynamic reward text and an interactive Claim button state.
    Open a character artboard in the same project; create a simple rig, Pin Hand IK, weighted hair mesh and attack event/socket.
    Connect both assets to a small Logic graph.
    Open Ship: see green diagnostics plus one intentionally fixable optimization warning.
    Export .bbb and drop it into both a Unity sample and Cocos sample; drive the same parameters and event names.
    Show profiler overlay and identical state transitions in editor and engine.
    PUBLIC DEMO TESTIf the demo needs a developer to repair the exported asset by hand, the product thesis is not yet proven.
