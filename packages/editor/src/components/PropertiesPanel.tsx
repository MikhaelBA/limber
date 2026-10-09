import { MeshWeightsPanel } from './MeshWeightsPanel';
import { useEffect, useRef, useState } from 'react';
import { SetKeyframeCommand, KeySlotColorCommand, type BonePropertyName } from '../commands/animationCommands';
import {
  SetBonePropsCommand,
  wouldCreateCycle,
  ReparentBoneCommand,
  type BonePropsSnapshot,
} from '../commands/boneCommands';
import {
  AddAttachmentCommand,
  AddPolygonAttachmentCommand,
  RemoveAttachmentCommand,
  SetAttachmentPropsCommand,
  SetClipEndSlotCommand,
  SetSlotAttachmentCommand,
  regionOf,
  type AttachmentTarget,
  type RegionParams,
} from '../commands/attachmentCommands';
import { AddMeshCommand } from '../commands/meshCommands';
import { AddIKConstraintCommand, RemoveIKConstraintCommand, SetIKPropsCommand } from '../commands/ikCommands';
import {
  RemoveSlotCommand,
  SetSlotBlendCommand,
  SetSlotPropsCommand,
  type SlotPropsSnapshot,
} from '../commands/slotCommands';
import { AddSkinCommand, RemoveSkinCommand, SetActiveSkinCommand } from '../commands/skinCommands';
import { textureRegistry } from '../engine/TextureRegistry';
import { useEngine } from '../hooks/useEngine';
import { useEditorStore } from '../store/editorStore';

const DEG = 180 / Math.PI;

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Packed RGBA uint32 -> "#rrggbb" for <input type="color">. */
function packedToHex(c: number): string {
  return '#' + ((c >>> 16) & 0xffffff).toString(16).padStart(6, '0');
}

/**
 * Numeric field that commits ON BLUR/ENTER — typing "120" is one undo step, not
 * three (DESIGN.md §5.3 text-input coalescing). External value changes while
 * not focused (undo/redo) resync the text.
 */
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
  step?: number;
}) {
  const [text, setText] = useState(() => fmt(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(fmt(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(fmt(value));
  };

  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-neutral-400">{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onFocus={() => (focusedRef.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm ring-neutral-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(value);
  }, [value]);
  const commit = () => {
    if (text !== value && text.trim() !== '') onCommit(text.trim());
    else setText(value);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-neutral-400">{label}</span>
      <input
        type="text"
        value={text}
        onFocus={() => (focusedRef.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm ring-neutral-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
    </label>
  );
}

/** Captures the bone's current editable state as a command snapshot. */
function snapshot(name: string, length: number, setup: BonePropsSnapshot['setup']): BonePropsSnapshot {
  return { name, length, setup: { ...setup } };
}

function slotSnapshot(s: { name: string; boneId: string; color: number }): SlotPropsSnapshot {
  return { name: s.name, boneId: s.boneId, color: s.color };
}

export function PropertiesPanel() {
  const engine = useEngine();
  useEditorStore((s) => s.dataRevision); // Re-read engine data on undo/redo/commands.
  const selected = useEditorStore((s) => s.selectedBoneId);
  const selectedSlotId = useEditorStore((s) => s.selectedSlotId);
  const mode = useEditorStore((s) => s.mode);
  const execute = useEditorStore((s) => s.execute);
  const setStatus = useEditorStore((s) => s.setStatus);
  const selectSlot = useEditorStore((s) => s.selectSlot);
  // Texture picker choice for "New region" — harmless state when no slot selected.
  const [textureChoice, setTextureChoice] = useState('');

  const data = engine.skeleton.data;
  const slot = selectedSlotId ? data.slots.find((s) => s.id === selectedSlotId) : undefined;
  const bone = selected ? data.bones.find((b) => b.id === selected) : undefined;

  const editBone = (apply: (snap: BonePropsSnapshot) => void) => {
    if (!bone) return;
    const before = snapshot(bone.name, bone.length, bone.setupPose);
    const after = snapshot(bone.name, bone.length, bone.setupPose);
    apply(after);
    execute(new SetBonePropsCommand(engine, bone.id, before, after));
  };

  const editSlot = (apply: (snap: SlotPropsSnapshot) => void) => {
    if (!slot) return;
    const before = slotSnapshot(slot);
    const after = slotSnapshot(slot);
    apply(after);
    execute(new SetSlotPropsCommand(engine, slot.id, before, after));
  };

  const editAttachment = (apply: (region: RegionParams, after: { name: string; region: RegionParams }) => void) => {
    if (!slot) return;
    const shownId = shownAttachmentId(engine, slot.id);
    const attachment = shownId ? data.attachments.find((a) => a.id === shownId) : undefined;
    if (!attachment) return;
    const before = { name: attachment.name, region: regionOf(attachment) };
    const after = { name: attachment.name, region: regionOf(attachment) };
    apply(after.region, after);
    execute(new SetAttachmentPropsCommand(engine, attachment.id, before, after));
  };

  // ---- Slot section state (safe no-ops when nothing is selected) ----
  const usingSkin = data.activeSkin !== '';
  const skinTarget: AttachmentTarget = usingSkin ? 'skin' : 'default';
  const skin = usingSkin ? data.skins.find((x) => x.name === data.activeSkin) : undefined;
  const slotIndex = slot ? engine.skeleton.slotIndexMap.get(slot.id) : undefined;
  const shownColor = slot && slotIndex !== undefined ? engine.skeleton.pose.slots[slotIndex]!.color : 0xffffffff;
  const editValue = slot ? (usingSkin ? skin?.attachments[slot.id] ?? null : slot.defaultAttachmentId) : null;
  const shownAttId = slot ? shownAttachmentId(engine, slot.id) : null;
  const shownAtt = shownAttId ? data.attachments.find((a) => a.id === shownAttId) : undefined;
  const textures = Object.entries(engine.document.assetManifest);
  const animating = mode === 'animate' && !!engine.currentAnimation;

  /** Animate mode: color edits key at the playhead (§5.6 auto-key). */
  const commitColor = (color: number) => {
    if (!slot) return;
    if (animating) execute(new KeySlotColorCommand(engine, slot.id, color));
    else editSlot((snap) => (snap.color = color));
  };

  const title = slot ? 'Slot' : bone ? 'Bone' : 'None';

  return (
    <aside aria-label="Character properties" className="flex h-full flex-col overflow-auto bg-neutral-900">
      <div className="border-b border-neutral-800 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Properties — {title}
      </div>

      {!slot && !bone && <p className="p-3 text-xs text-neutral-500">Select a bone or slot to edit it.</p>}

      {/* ---------------- Slot (Phase 4) ---------------- */}
      {slot && (
        <div className="flex flex-col gap-1.5 p-2">
          <TextField label="Name" value={slot.name} onCommit={(name) => editSlot((snap) => (snap.name = name))} />
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-neutral-400">Bone</span>
            <select
              value={slot.boneId}
              onChange={(e) => editSlot((snap) => (snap.boneId = e.target.value))}
              className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              {data.bones.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="my-1 h-px bg-neutral-800" />
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-neutral-400">Color</span>
            <input
              type="color"
              value={packedToHex(shownColor)}
              onChange={(e) => commitColor((parseInt(e.target.value.slice(1), 16) << 24) | (shownColor & 0xff))}
              className="h-6 w-10 cursor-pointer rounded bg-neutral-800"
            />
            <span className="text-[10px] text-neutral-500">alpha</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              defaultValue={Math.round(((shownColor & 0xff) / 255) * 100) / 100}
              key={`alpha-${shownColor & 0xff}`}
              onBlur={(e) => {
                const v = Math.min(Math.max(parseFloat(e.target.value) || 0, 0), 1);
                commitColor((shownColor & 0xffffff00) | Math.round(v * 255));
              }}
              className="w-14 rounded bg-neutral-800 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            {animating && <span className="text-[10px] text-amber-400/80">auto-key</span>}
          </div>
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-neutral-400">Blend</span>
            <select
              value={slot.blendMode ?? 'normal'}
              onChange={(e) => execute(new SetSlotBlendCommand(engine, slot.id, e.target.value as 'normal' | 'add'))}
              className="w-full rounded bg-neutral-800 px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
              title="Additive blending for glow effects"
            >
              <option value="normal">normal</option>
              <option value="add">add</option>
            </select>
          </label>
          <div className="my-1 h-px bg-neutral-800" />
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-neutral-400">Attach</span>
            <select
              value={editValue ?? ''}
              onChange={(e) => execute(new SetSlotAttachmentCommand(engine, slot.id, e.target.value || null, skinTarget))}
              className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">(none)</option>
              {data.attachments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {usingSkin && (
            <p className="text-[10px] text-neutral-500">
              editing skin “{data.activeSkin}” override{editValue === null && ' — falls back to default'}
            </p>
          )}
          {shownAtt && shownAtt.type === 'region' && (
            <>
              <div className="my-1 h-px bg-neutral-800" />
              <TextField
                label="Att name"
                value={shownAtt.name}
                onCommit={(name) => editAttachment((_r, after) => (after.name = name))}
              />
              <NumberField label="Att X" value={regionOf(shownAtt).x} onCommit={(x) => editAttachment((r) => (r.x = x))} />
              <NumberField label="Att Y" value={regionOf(shownAtt).y} onCommit={(y) => editAttachment((r) => (r.y = y))} />
              <NumberField label="Att W" value={regionOf(shownAtt).width} onCommit={(w) => editAttachment((r) => (r.width = Math.max(1, w)))} />
              <NumberField label="Att H" value={regionOf(shownAtt).height} onCommit={(h) => editAttachment((r) => (r.height = Math.max(1, h)))} />
              <button
                className="mt-1 self-start rounded bg-neutral-800 px-2 py-0.5 text-xs text-red-300 hover:bg-neutral-700"
                onClick={() => execute(new RemoveAttachmentCommand(engine, shownAtt.id))}
              >
                Delete attachment
              </button>
            </>
          )}
          {shownAtt && shownAtt.type === 'mesh' && shownAtt.meshVertices && (
            <p className="text-[10px] text-neutral-500">
              mesh — {shownAtt.meshVertices.length / 2} vertices · {(shownAtt.meshTriangles?.length ?? 0) / 3} tris ·
              ◈ drag / dbl-click add / Alt+click delete · animate mode drags key deform
            </p>
          )}
          {shownAtt?.type === 'mesh' && <MeshWeightsPanel key={shownAtt.id} attachmentId={shownAtt.id} />}
          {shownAtt && (shownAtt.type === 'boundingBox' || shownAtt.type === 'clipping') && shownAtt.meshVertices && (
            <>
              <p className="text-[10px] text-neutral-500">
                {shownAtt.type === 'boundingBox' ? 'bounding box' : 'clipping'} —{' '}
                {shownAtt.meshVertices.length / 2} vertices · edit with the ◈ Mesh tool
              </p>
              {shownAtt.type === 'clipping' && (
                <label className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-neutral-400">end slot</span>
                  <select
                    value={shownAtt.endSlotId ?? ''}
                    onChange={(e) =>
                      execute(new SetClipEndSlotCommand(engine, shownAtt.id, e.target.value || null))
                    }
                    className="w-full rounded bg-neutral-800 px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                    title="Clipping applies until this slot (exclusive)"
                  >
                    <option value="">(last slot)</option>
                    {data.slots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <div className="my-1 h-px bg-neutral-800" />
          {textures.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={textureChoice || textures[0]![0]}
                onChange={(e) => setTextureChoice(e.target.value)}
                className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {textures.map(([id, meta]) => (
                  <option key={id} value={id}>
                    {meta.name}
                  </option>
                ))}
              </select>
              <button
                className="shrink-0 rounded bg-sky-700 px-2 py-0.5 text-xs text-white hover:bg-sky-600"
                title="Create a region attachment sized to the texture, centered on the bone"
                onClick={() => {
                  const textureId = textureChoice || textures[0]![0];
                  const tex = textureRegistry.get(textureId);
                  execute(
                    new AddAttachmentCommand(
                      engine,
                      slot.id,
                      { textureId, x: 0, y: 0, width: tex?.width ?? 100, height: tex?.height ?? 100 },
                      skinTarget,
                    ),
                  );
                }}
              >
                New region
              </button>
              <button
                className="shrink-0 rounded bg-neutral-700 px-2 py-0.5 text-xs text-white hover:bg-neutral-600"
                title="Create a 3×3-vertex grid mesh (editable with the Mesh/Weights tools)"
                onClick={() => {
                  const textureId = textureChoice || textures[0]![0];
                  const tex = textureRegistry.get(textureId);
                  execute(
                    new AddMeshCommand(
                      engine,
                      slot.id,
                      {
                        textureId,
                        x: 0,
                        y: 0,
                        width: tex?.width ?? 100,
                        height: tex?.height ?? 100,
                        cols: 2,
                        rows: 2,
                      },
                      skinTarget,
                    ),
                  );
                }}
              >
                Grid mesh
              </button>
              <button
                className="shrink-0 rounded bg-neutral-700 px-2 py-0.5 text-xs text-white hover:bg-neutral-600"
                title="Add a bounding box polygon (hit-testing; editable with the Mesh tool)"
                onClick={() => {
                  const tex = textureRegistry.get(textureChoice || textures[0]![0]);
                  execute(
                    new AddPolygonAttachmentCommand(
                      engine,
                      slot.id,
                      { x: 0, y: 0, width: tex?.width ?? 60, height: tex?.height ?? 60 },
                      'boundingBox',
                      skinTarget,
                    ),
                  );
                }}
              >
                BBox
              </button>
              <button
                className="shrink-0 rounded bg-violet-800 px-2 py-0.5 text-xs text-white hover:bg-violet-700"
                title="Add a clipping polygon — clips subsequent slots (until the end slot)"
                onClick={() => {
                  execute(
                    new AddPolygonAttachmentCommand(engine, slot.id, { x: 0, y: 0, width: 80, height: 80 }, 'clipping', skinTarget),
                  );
                }}
              >
                Clip
              </button>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">Drop images on the viewport to import textures.</p>
          )}
          <button
            className="mt-1 self-start rounded bg-neutral-800 px-2 py-0.5 text-xs text-red-300 hover:bg-neutral-700"
            onClick={() => {
              execute(new RemoveSlotCommand(engine, slot.id));
              selectSlot(null);
            }}
          >
            Delete slot
          </button>
        </div>
      )}

      {/* ---------------- Bone (Phases 2–3) ---------------- */}
      {bone && !slot && (
        <div className="flex flex-col gap-1.5 p-2">
          <TextField label="Name" value={bone.name} onCommit={(name) => editBone((s) => (s.name = name))} />
          <div className="my-1 h-px bg-neutral-800" />
          {/* §5.6: Animate mode shows/keys the CURRENT animated pose; Setup edits the rig. */}
          <BoneTransformFields engine={engine} boneId={bone.id} />
          <NumberField label="Length" value={bone.length} onCommit={(v) => editBone((s) => (s.length = v))} />
          <div className="my-1 h-px bg-neutral-800" />
          <label className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-neutral-400">Parent</span>
            <select
              aria-label="Bone parent"
              value={bone.parentId ?? ''}
              onChange={(e) => {
                const next = e.target.value || null;
                if (next === bone.id || (next && wouldCreateCycle(data, bone.id, next))) {
                  setStatus('Cannot parent a bone under its own descendant.');
                  return;
                }
                try { execute(new ReparentBoneCommand(engine, bone.id, next)); }
                catch (error) { setStatus((error as Error).message); }
              }}
              className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">(root)</option>
              {data.bones
                .filter((b) => b.id !== bone.id && !wouldCreateCycle(data, bone.id, b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>

          {/* IK constraints this bone participates in (chain or target). */}
          {data.ikConstraints
            .filter((c) => c.bones.includes(bone.id) || c.targetId === bone.id)
            .map((c) => {
              const chainLabel = c.bones.map((id) => data.bones.find((b) => b.id === id)?.name ?? '?').join('→');
              return (
                <div key={c.id} className="mt-1 rounded bg-neutral-800/40 p-1.5">
                  <div className="mb-1 flex items-center gap-1 text-[11px] text-amber-300/90">
                    ⚙ IK {chainLabel} ⇢ {data.bones.find((b) => b.id === c.targetId)?.name ?? '?'}
                    <button
                      className="ml-auto rounded px-1 text-xs text-red-300 hover:bg-neutral-700"
                      title="Delete IK constraint (target bone stays)"
                      onClick={() => execute(new RemoveIKConstraintCommand(engine, c.id))}
                    >
                      🗑
                    </button>
                  </div>
                  <NumberField
                    label="mix"
                    value={Math.round(c.mix * 100) / 100}
                    onCommit={(v) => execute(new SetIKPropsCommand(engine, c.id, { mix: Math.min(1, Math.max(0, v)) }))}
                  />
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-neutral-400">bend</span>
                    <button
                      className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700"
                      title="Flip the elbow side"
                      onClick={() =>
                        execute(new SetIKPropsCommand(engine, c.id, { bendDirection: c.bendDirection === 1 ? -1 : 1 }))
                      }
                    >
                      {c.bendDirection === 1 ? '↷ cw' : '↶ ccw'}
                    </button>
                  </div>
                  <label className="mt-1 flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-neutral-400">target</span>
                    <select
                      value={c.targetId}
                      onChange={(e) => execute(new SetIKPropsCommand(engine, c.id, { targetId: e.target.value }))}
                      className="w-full rounded bg-neutral-800 px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      {data.bones
                        .filter((b) => !c.bones.includes(b.id))
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              );
            })}
          {data.ikConstraints.length === 0 && (
            <button
              className="mt-1 self-start rounded bg-neutral-800 px-2 py-0.5 text-xs text-amber-200 hover:bg-neutral-700"
              title="Create an IK constraint controlling this bone (plus its parent) with a new target bone at its tip"
              onClick={() => {
                const cmd = new AddIKConstraintCommand(engine, bone.id);
                execute(cmd);
              }}
            >
              ＋ Add IK
            </button>
          )}
        </div>
      )}

      {/* ---------------- Skins (always visible) ---------------- */}
      <div className="mt-auto border-t border-neutral-800 p-2">
        <div className="mb-1 flex items-center gap-1">
          <span className="mr-auto text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Skins
          </span>
          <button
            className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            title="Add skin"
            onClick={() => execute(new AddSkinCommand(engine))}
          >
            ＋
          </button>
          <button
            className="rounded px-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
            title="Delete active skin"
            disabled={data.activeSkin === ''}
            onClick={() => {
              const name = data.activeSkin;
              execute(new SetActiveSkinCommand(engine, ''));
              execute(new RemoveSkinCommand(engine, name));
            }}
          >
            🗑
          </button>
        </div>
        <select
          value={data.activeSkin}
          onChange={(e) => execute(new SetActiveSkinCommand(engine, e.target.value))}
          className="w-full rounded bg-neutral-800 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          <option value="">(no skin — defaults)</option>
          {data.skins.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        {data.skins.length === 0 && (
          <p className="mt-1 text-[10px] text-neutral-500">
            Skins override which attachment each slot shows.
          </p>
        )}
      </div>
    </aside>
  );
}

/** The attachment a slot currently DISPLAYS (skin override, else default). */
function shownAttachmentId(engine: ReturnType<typeof useEngine>, slotId: string): string | null {
  const data = engine.skeleton.data;
  const slot = data.slots.find((s) => s.id === slotId);
  if (!slot) return null;
  if (data.activeSkin !== '') {
    const skin = data.skins.find((s) => s.name === data.activeSkin);
    if (skin && skin.attachments[slotId] !== undefined) return skin.attachments[slotId]!;
  }
  return slot.defaultAttachmentId;
}

/**
 * Bone transform fields split out because they need the ANIMATED pose values —
 * reads engine.skeleton.pose directly (re-rendered via dataRevision/touch).
 */
function BoneTransformFields({ engine, boneId }: { engine: ReturnType<typeof useEngine>; boneId: string }) {
  const mode = useEditorStore((s) => s.mode);
  const execute = useEditorStore((s) => s.execute);
  const data = engine.skeleton.data;
  const bone = data.bones.find((b) => b.id === boneId)!;
  const animating = mode === 'animate' && !!engine.currentAnimation;
  const poseLocal = animating
    ? engine.skeleton.pose.bones[engine.skeleton.boneIndexMap.get(boneId)!]?.local
    : undefined;

  const keyProp = (prop: BonePropertyName, value: number) => {
    execute(new SetKeyframeCommand(engine, boneId, prop, engine.currentTime, value));
  };
  const src = (prop: BonePropertyName): number =>
    animating && poseLocal ? poseLocal[prop] : bone.setupPose[prop];
  const commitTransform = (prop: BonePropertyName, value: number) => {
    if (animating) keyProp(prop, value);
    else
      execute(
        new SetBonePropsCommand(
          engine,
          boneId,
          { name: bone.name, length: bone.length, setup: { ...bone.setupPose } },
          (() => {
            const setup = { ...bone.setupPose };
            setup[prop] = value;
            return { name: bone.name, length: bone.length, setup };
          })(),
        ),
      );
  };

  return (
    <>
      <NumberField label="X" value={src('x')} onCommit={(x) => commitTransform('x', x)} />
      <NumberField label="Y" value={src('y')} onCommit={(y) => commitTransform('y', y)} />
      {/* Radians in the data model, degrees at the UI boundary (§8.1). */}
      <NumberField
        label="Rot °"
        step={5}
        value={src('rotation') * DEG}
        onCommit={(deg) => commitTransform('rotation', deg / DEG)}
      />
      <NumberField label="Scale X" step={0.1} value={src('scaleX')} onCommit={(v) => commitTransform('scaleX', v)} />
      <NumberField label="Scale Y" step={0.1} value={src('scaleY')} onCommit={(v) => commitTransform('scaleY', v)} />
      <NumberField
        label="Shear X °"
        step={5}
        value={src('shearX') * DEG}
        onCommit={(deg) => commitTransform('shearX', deg / DEG)}
      />
      <NumberField
        label="Shear Y °"
        step={5}
        value={src('shearY') * DEG}
        onCommit={(deg) => commitTransform('shearY', deg / DEG)}
      />
    </>
  );
}
