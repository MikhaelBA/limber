import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '@limber/core';
import { createRuntimeBudget, RuntimeFormatError } from '@limber/runtime';
import { captureProjectSnapshot } from '../src/persistence/projectSnapshot';
import { readShipBudget, saveShipBudget, SHIP_BUDGET_STORAGE_KEY } from '../src/persistence/shipSettings';

const source = () =>
  deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v13-interactive.json', import.meta.url), 'utf8'),
  );
describe('owned Save/Ship snapshots and workspace policies', () => {
  it('captures project and immutable texture references before async encoding, preserving concurrent edits', async () => {
    const project = source(),
      original = structuredClone(project),
      id = Object.keys(project.assetManifest)[0]!,
      originalName = project.name;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    class HeldBlob extends Blob {
      override async arrayBuffer() {
        await ready;
        return super.arrayBuffer();
      }
    }
    const bytes = readFileSync(new URL('../../../fixtures/ui-rtl-v1.png', import.meta.url)),
      entries = [{ textureId: id, blob: new HeldBlob([bytes], { type: 'image/png' }) }];
    const snapshot = captureProjectSnapshot(project, entries);
    project.name = 'Changed during encoding';
    project.artboards[0]!.name = 'Edited board';
    project.assetManifest[id]!.name = 'New metadata';
    entries[0]!.blob = new Blob(['later'], { type: 'image/jpeg' });
    release();
    const captured = await snapshot;
    expect(captured.embedded).toBe(1);
    expect(captured.project.name).toBe(originalName);
    expect(captured.project.artboards).toEqual(original.artboards);
    expect(captured.project.assetManifest[id]!.name).toBe(original.assetManifest[id]!.name);
    expect(captured.project.assetManifest[id]!.dataUrl).toBe(
      `data:image/png;base64,${bytes.toString('base64')}`,
    );
    expect(project.name).toBe('Changed during encoding');
    captured.project.artboards[0]!.nodes.length = 0;
    expect(project.artboards[0]!.nodes.length).toBe(original.artboards[0]!.nodes.length);
  });
  it('retains existing embedded metadata with no loaded blobs and rejects invalid captures without source mutation', async () => {
    const project = source(),
      before = serializeProject(project);
    const captured = await captureProjectSnapshot(project, []);
    expect(captured.embedded).toBe(0);
    expect(serializeProject(captured.project)).toBe(before);
    project.editor.activeArtboardId = 'missing';
    const invalid = JSON.stringify(project);
    await expect(captureProjectSnapshot(project, [])).rejects.toThrow();
    expect(JSON.stringify(project)).toBe(invalid);
  });
  it('owns saved custom budgets and restores a preset on corrupt/unavailable workspace storage', () => {
    const map = new Map<string, string>(),
      storage = {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
      };
    expect(readShipBudget(storage).budget.preset).toBe('web');
    const budget = createRuntimeBudget('custom', { drawCalls: 3, updateP95Ms: 0.5 }),
      owned = saveShipBudget(storage, budget);
    budget.limits.drawCalls = 999;
    expect(owned.limits.drawCalls).toBe(3);
    expect(readShipBudget(storage).budget).toEqual(owned);
    const before = map.get(SHIP_BUDGET_STORAGE_KEY);
    expect(() => saveShipBudget(storage, { ...owned, limits: { ...owned.limits, vertices: NaN } })).toThrow(
      RuntimeFormatError,
    );
    expect(map.get(SHIP_BUDGET_STORAGE_KEY)).toBe(before);
    map.set(SHIP_BUDGET_STORAGE_KEY, 'broken json');
    expect(readShipBudget(storage)).toMatchObject({ budget: { preset: 'web' }, warning: expect.any(String) });
    expect(
      readShipBudget({
        getItem() {
          throw new Error('blocked storage');
        },
      }),
    ).toMatchObject({ budget: { preset: 'web' }, warning: expect.any(String) });
    expect(() =>
      saveShipBudget(
        {
          setItem() {
            throw new Error('quota');
          },
        },
        owned,
      ),
    ).toThrow('quota');
  });
});
