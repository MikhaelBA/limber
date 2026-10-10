# BoneByBone portable runtime

`@limber/runtime` now has an independent native path alongside the retained legacy
`RuntimePlayer`. It has no React, Pixi or editor dependency. Rendering and actual
image/font decoding are separate adapters and remain part of Phase 9 delivery.

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
pixel decode, SVG conversion, atlas/font workers and Ship UI are still outstanding.
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

Native artboard orchestration, the Web render adapter and integrated
export/load/render acceptance follow separately; this character API does not close Phase 9.

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

Scene/UI playback is now available; scene/character orchestration, actual Web rendering
and the integrated shipping workflow are still separate pending gates.
