import type { SkeletonData, SkinData } from '@limber/core';
import { Skeleton } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

function editSkins(engine: EditorEngine, edit: (data: SkeletonData) => void): void {
  const proposed = structuredClone(engine.skeleton.data);
  edit(proposed);
  new Skeleton(proposed);
  const data = engine.skeleton.data;
  const switched = data.activeSkin !== proposed.activeSkin;
  data.skins = proposed.skins;
  data.activeSkin = proposed.activeSkin;
  if (switched) engine.skeleton.rebuild();
}

/** Creates an empty skin (no per-slot overrides yet). */
export class AddSkinCommand implements Command {
  name = 'skin';
  private named = false;
  private _label = 'Add Skin';

  constructor(private engine: EditorEngine) {}

  get label(): string {
    return this._label;
  }

  do(): void {
    if (!this.named) {
      const names = new Set(this.engine.skeleton.data.skins.map((s) => s.name));
      let i = 2;
      while (names.has(this.name)) this.name = this.name.replace(/\d+$/, '') + i++;
      this.named = true;
      this._label = `Add Skin ${this.name}`;
    }
    editSkins(this.engine, (data) => {
      data.skins.push({ name: this.name, attachments: {} });
    });
  }

  undo(): void {
    editSkins(this.engine, (data) => {
      const index = data.skins.findIndex((s) => s.name === this.name);
      if (index < 0) throw new Error(`Skin "${this.name}" not found.`);
      data.skins.splice(index, 1);
      if (data.activeSkin === this.name) data.activeSkin = '';
    });
  }
}

/** Removes a skin; removing the ACTIVE skin falls back to no skin (''). */
export class RemoveSkinCommand implements Command {
  readonly label: string;
  private removed: SkinData | null = null;
  private index: number;
  private wasActive = false;

  constructor(
    private engine: EditorEngine,
    readonly name: string,
  ) {
    this.index = engine.skeleton.data.skins.findIndex((s) => s.name === name);
    if (this.index < 0) throw new Error(`RemoveSkinCommand: skin "${name}" not found.`);
    this.label = `Delete Skin ${name}`;
  }

  do(): void {
    const data = this.engine.skeleton.data;
    const index = data.skins.findIndex((skin) => skin.name === this.name);
    if (index < 0) throw new Error(`Skin "${this.name}" not found.`);
    const removed = structuredClone(data.skins[index]!);
    const wasActive = data.activeSkin === this.name;
    editSkins(this.engine, (proposed) => {
      proposed.skins.splice(index, 1);
      if (wasActive) proposed.activeSkin = '';
    });
    this.index = index;
    this.removed = removed;
    this.wasActive = wasActive;
  }

  undo(): void {
    if (!this.removed) return;
    const removed = this.removed;
    editSkins(this.engine, (data) => {
      data.skins.splice(Math.min(this.index, data.skins.length), 0, structuredClone(removed));
      if (this.wasActive) data.activeSkin = this.name;
    });
  }
}

/**
 * Selects the active skin ('' = none: slots show their default attachments).
 * resetPose resolves skin overrides every frame, so switching is immediately
 * visible. Unknown names throw via Skeleton validation — call sites catch.
 */
export class SetActiveSkinCommand implements Command {
  readonly label: string;
  private readonly before: string;

  constructor(
    private engine: EditorEngine,
    readonly name: string, // '' for none
  ) {
    this.before = engine.skeleton.data.activeSkin;
    this.label = name ? `Set Skin ${name}` : 'Clear Skin';
  }

  do(): void {
    this.apply(this.name);
  }

  undo(): void {
    this.apply(this.before);
  }

  private apply(name: string): void {
    editSkins(this.engine, (data) => {
      data.activeSkin = name;
    });
  }
}
