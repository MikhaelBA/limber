import type { SkinData } from '@limber/core';
import type { EditorEngine } from '../engine/EditorEngine';
import type { Command } from '../history/history';

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
    this.engine.skeleton.data.skins.push({ name: this.name, attachments: {} });
  }

  undo(): void {
    const skins = this.engine.skeleton.data.skins;
    skins.splice(skins.findIndex((s) => s.name === this.name), 1);
    if (this.engine.skeleton.data.activeSkin === this.name) {
      this.engine.skeleton.data.activeSkin = '';
      this.engine.skeleton.rebuild();
    }
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
    this.removed = data.skins.splice(this.index, 1)[0] ?? null;
    this.wasActive = data.activeSkin === this.name;
    if (this.wasActive) {
      data.activeSkin = '';
      this.engine.skeleton.rebuild();
    }
  }

  undo(): void {
    if (!this.removed) return;
    const data = this.engine.skeleton.data;
    data.skins.splice(Math.min(this.index, data.skins.length), 0, this.removed);
    if (this.wasActive) {
      data.activeSkin = this.name;
      this.engine.skeleton.rebuild();
    }
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
    this.engine.skeleton.data.activeSkin = name;
    this.engine.skeleton.rebuild(); // Throws on unknown skin names (validation).
  }
}
