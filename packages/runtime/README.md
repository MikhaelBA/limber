# BoneByBone portable runtime

`@limber/runtime` now has an independent native path alongside the retained legacy
`RuntimePlayer`. It has no React, Pixi or editor dependency. Rendering and actual
image/font decoding live in `@limber/runtime-web`; the integrated Ship/asset workflow
remains part of Phase 9 delivery.

```ts
import {
  compileRuntime,
  encodeRuntime,
  serializeRuntime,
  loadRuntime,
  NativeRigPlayer,
} from '@limber/runtime';

const { program, diagnostics } = compileRuntime(sourceProject);
const shippingBytes = encodeRuntime(program); // compact UTF-8 .bbb
const debugJSON = serializeRuntime(program, { pretty: true });
const loaded = loadRuntime(shippingBytes);
const character = new NativeRigPlayer(loaded, rigId);
character.onEvent((event) => handleCue(event.ownerId, event.eventName, event.payload));
character.play('walk', { loop: true }); // explicitly selects raw animation mode
character.update(deltaSeconds);
draw(character.getWorldTransforms(), character.getDrawOrder());
```

Compiler diagnostics identify remaining host font requirements. The initial asset
stage accepts embedded PNG/JPEG/WebP and checks canonical encoding/MIME signatures;
Web pixel decode and explicit host font loading are available in `@limber/runtime-web`;
SVG conversion, atlas/font workers and Ship UI are still outstanding.
The runtime loader rejects renamed source and unknown fields/versions/features before
constructing a player. ADR 0024 defines the schema and resource bounds.

## Character playback

Players start paused, in authored Logic mode when a graph exists, otherwise in raw
animation mode. `play()` resumes the current mode; repeated resume is idempotent.
`play(name, options)` selects a raw clip and clears its queue. `useLogic()` selects a
fresh authored graph session and preserves whether the host was playing. Typed
`setBool/setFloat/setInt/setString`, `fire/resetTrigger`, `dispatch(event)` and
`setLogicEnabled` require Logic mode. Rig interaction routes target their viewport.

Every native mode uses the same bounded 120 Hz accepted-step policy, including raw
clips without springs. Updates accept at most 100 ms/twelve ticks. Pause discards the
fractional clock and rebases inertia once. Paused `step()` advances one tick and remains
paused without rebasing between Steps. Raw elapsed/fade time derives from integer ticks.

Raw fades hold the actual previous animation pose before constraints and blend toward
the newly sampled clip: shortest-arc rotation, continuous scale/translation/color/Deform,
and immediate destination attachments/draw order. Interrupted fades hold the currently
blended animation pose. Primary constraints and springs run after that blend, once per
accepted tick; setup cannot attenuate the outgoing weight a second time.

`queueAnimation(name, { loop, fadeDuration, delay })` appends to a FIFO capped at 256.
It starts immediately if there is no active clip. Otherwise it waits for the current
nonloop completion or the next loop-cycle completion, then holds the endpoint for the
full delay. The next clip starts on the following accepted tick, retaining the old
terminal event before the new entry event. Delays round up to ticks; fractional clip
durations reach their endpoint on the first tick at or after completion. A queued loop
does not emit a discarded next-cycle zero event. Zero-duration raw clips are static,
emit entry keys once and occupy at least one tick before the next queued clip starts.

`stop()` clears playback/queues, resets graph parameters and restores authored setup
while retaining host skin/attachment choices. `reset()` also clears those overrides and
returns to the paused initial authored mode. `setSkin(name)` and
`setAttachment(slotId, attachmentId | null)` are transient; explicit attachment overrides
win over skins/timelines until `clearAttachmentOverride(slotId)`. `getMarker(id, rigWorld)`
returns isolated metadata/geometry; `getSocket(id, rigWorld)` returns its composed affine
matrix and requires a socket marker. Omitting rigWorld returns rig-local world space.

World/vertex buffers, draw order and `skeleton` are read-only live adapter views. They
are rewritten during playback and must not be mutated. Events/snapshots/markers are
isolated copies. Host callbacks receive separate event copies; Stop/reset/mode switches
halt stale delivery, and reentrant update/Step fails before advancing. Callback exceptions
propagate while preserving the already accepted skinned pose. Event density is checked
against 4096 keys per accepted tick before starting a potentially dense loop.

The Web render adapter and integrated export/load/render acceptance follow separately;
these portable APIs do not close Phase 9.

## Scene playback and UI

`NativeScenePlayer(program, { artboardId, autoplay })` starts paused by default, using
the default runtime artboard and its authored graph when present. It has the same
Play/Pause/Step/Stop/reset, typed Logic, callback and raw FIFO/fade contract as characters.
Scene `play(clipId)` and `queueAnimation(clipId)` use stable IDs because display names
may repeat. `useLogic()` resets only the scene graph session.

`getView()` returns cached expanded scene/UI nodes without private sampling metadata.
`getView({ expanded: false })` returns authored instance nodes with their transient
bound overrides. Both are read-only live views. `getNodeOwner(renderedId)` identifies
the authored node responsible for a rendered descendant; `dispatch(event, renderedId)`
uses that owner when routing component interactions. A null target routes the viewport.
Raw mode or an artboard without Logic has no active scene interaction routes.

`resize(width, height, safeArea)` changes host layout dimensions, preserving source,
clip state and current parameters. Insets must fit the new viewport; omitting them
retains the current safe area. `evaluate()` returns portable world transforms/boxes,
inherited visibility/tint/opacity and subtree order. Masks, nine-slice source/borders,
RTL text and exposures remain part of the native view. Host viewport settings survive
playback reset. Held/zero-step frames reuse the cached view.

## Shared assets and artboard playback

```ts
const asset = new NativeRuntimeAsset(loadRuntime(shippingBytes));
const first = new NativeArtboardPlayer(asset, { autoplay: true });
const second = new NativeArtboardPlayer(asset); // independent mutable playback state
first.onEvent((event) => handleCue(event.ownerId, event.artboardTick, event.payload));
first.getRig(characterId).fire('open');
first.update(deltaSeconds);
drawScene(first.getView(), (id) => first.getRig(id).skeleton);
```

`NativeRuntimeAsset` validates/detaches once and can create independent scene, character
or artboard instances. `getProgram()`, `getArtboards()` and `getTexture(id)` return
detached publications. `getTextures()` and `getFontRequirements()` expose detached
resource staging metadata. Authored rig expansion is cached once per asset/artboard;
working skeleton/graph state stays independent. Standalone players also accept a
compiled program directly.

`NativeArtboardPlayer` owns one bounded 120 Hz clock for the scene and all characters,
including characters expanded from reusable UI components. Each accepted global tick
commits scene motion/bindings and all character poses before delivering host events.
Events deliver in scene-first, expanded-character order. Root listeners run before
the emitting child's listeners; every listener receives an isolated copy. The root
event adds `artboardTick` without changing the emitting owner's local tick. Callback
inputs take effect on the next accepted global tick, independent of frame grouping.
Stop/reset/session changes cancel stale delivery. Callback exceptions propagate and
the accepted frame is finalized before returning control to the host.

`scene` and `getRig(id)` expose per-owner controls, parameters and snapshots. Their
`update`/`step` are blocked while owned: advance through the artboard. `play()` resumes
all owners; an explicit child pause/disable can hold one owner while others advance.
Paused artboard `step()` advances owners once and remains paused, even if a callback
starts a session. Stop resets global time and restores setup; reset additionally clears
host character overrides. Host viewport dimensions/safe area survive both commands.

World/slot/marker state is committed within callbacks. Skinned vertex buffers publish
once at the end of a displayed update/Step, retaining buffer identity. Read vertices
after the outer call returns. Zero-step frames do not skin again. `getSocket(rigId,
markerId)` and `getMarker(rigId, markerId)` compose responsive scene world transforms.
`dispatch(event, renderedId)` routes scene/component hits; character viewport signals
remain explicit through `getRig(id).dispatch(event)`. Component-local graphs remain
outside the current authoring contract; instanced characters support raw clips.

The shared Web render adapter stages real image/page pixels and supplied host fonts.
SVG rasterization and packed native compilation run in an owned browser worker; font
packaging and the integrated shipping workspace remain Phase 9 gates.

## Packed native resources

Unreleased v1 texture records discriminate `type: 'image'` (MIME/base64 pixels) from
`type: 'atlas'` (page ID, source dimensions, logical crop, physical frame, clockwise
rotation, scale and empty flag). The required `atlasPages` table stores shared PNG
bytes, dimensions, padding and honest `premultiplied: false` metadata. This pre-release
contract is intentionally updated without backward-reader adapters.

`compilePackedRuntime(source, { textures, pages }, options)` is the pure compiler
entry for prepared assets; image records may coexist with atlas regions. It validates
source/runtime semantics and every packed reference/frame/crop/gutter/budget, but does
not claim to decode PNG bodies. Body conversion/decode belongs to the browser worker/
host. `runtimeTextureRequirements` discovers referenced IDs and whether each permits
trim. Mesh/rig/nine-slice images must retain the entire authored UV domain. Source
atlas region flattening remains an explicit unsupported export finding.

`NativeRuntimeAsset.getTextures`, `getTexture` and `getAtlasPages` publish detached
metadata, including nested crop/frame rectangles. Playback does not decode resources
or rewrite source UVs/geometry. `@limber/runtime-web` creates logical views over unique
page uploads, preserving original logical size and source clamp-to-edge sampling.

## Portable font records

Source schema 14 optionally carries `fonts`; native v1 requires this table (empty for
font-free exports). Referenced single-file TTF/OTF records contain ID, family, format,
canonical bytes and complete license metadata. Fonts sort by ID; text fallback order
does not change. `NativeRuntimeAsset.getFonts()` returns detached nested records.
`runtimeFontRequirements` and `diagnoseNativeFonts` expose source/ship requirements and
actionable missing-glyph/fallback/license/embedding findings. Generic CSS families are
explicit host dependencies; the compiler never discovers or copies OS font files.

Structural preflight covers bounded encoding, sfnt table bounds and Unicode cmap
4/12/13. Default character coverage does not verify contextual shaping or variation
sequences. Actual decoding/publication belongs to worker/host adapters. Font budgets
are 32 files, 4 MiB each and 16 MiB total; static glyph diagnostics inspect at most
262144 text scalars. Actual dynamic/localized text must be previewed in the host.
