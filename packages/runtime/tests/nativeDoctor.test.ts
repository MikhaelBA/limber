import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PROJECT_FORMAT,
  PROJECT_SCHEMA_VERSION,
  sceneTransform,
  type BoneByBoneProject,
  type RigNode,
} from '@limber/core';
import {
  NativeRuntimeAsset,
  compileRuntime,
  compilePackedRuntime,
  RuntimeFormatError,
  createRuntimeBudget,
  validateRuntimeBudget,
  checkRuntimeBudget,
  inspectRuntimeInventory,
  RUNTIME_BUDGET_KEYS,
  type RuntimeBudget,
  type RuntimeProgram,
} from '@limber/runtime';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function source(): BoneByBoneProject {
  const transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
  const rig: RigNode = {
    id: 'rig',
    name: 'Rig',
    parentId: null,
    type: 'rig',
    transform: sceneTransform(),
    opacity: 1,
    visible: true,
    animations: [],
    skeleton: {
      bones: [
        { id: 'root', name: 'Root', parentId: null, setupPose: transform, length: 10 },
        { id: 'child', name: 'Child', parentId: 'root', setupPose: { ...transform, x: 10 }, length: 10 },
      ],
      slots: [
        { id: 'mesh-slot', name: 'Mesh', boneId: 'root', defaultAttachmentId: 'linked', color: 0xffffffff },
        {
          id: 'region-slot',
          name: 'Region',
          boneId: 'child',
          defaultAttachmentId: 'region',
          color: 0xffffffff,
        },
        { id: 'clip-slot', name: 'Clip', boneId: 'root', defaultAttachmentId: 'clip', color: 0xffffffff },
      ],
      attachments: [
        {
          id: 'mesh',
          name: 'Owned',
          type: 'mesh',
          textureId: 'image-a',
          meshVertices: [0, 0, 10, 0, 0, 10],
          meshTriangles: [0, 1, 2],
          meshUVs: [0, 0, 1, 0, 0, 1],
          weights: [2, 0, 0.5, 1, 0.5, 0, 1, 1, 1],
        },
        {
          id: 'linked',
          name: 'Linked',
          type: 'mesh',
          textureId: 'image-a',
          meshSourceId: 'mesh',
          weights: [1, 1, 1, 1, 1, 1, 1, 1, 1],
        },
        {
          id: 'region',
          name: 'Region',
          type: 'region',
          textureId: 'image-b',
          vertices: [0, 0, 10, 0, 10, 10, 0, 10],
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        },
        {
          id: 'clip',
          name: 'Clip',
          type: 'clipping',
          textureId: '',
          meshVertices: [0, 0, 10, 0, 0, 10],
          endSlotId: null,
        },
      ],
      ikConstraints: [],
      transformConstraints: [
        {
          id: 'follow',
          boneId: 'child',
          targetId: 'root',
          space: 'local',
          offset: transform,
          mixTranslation: 0,
          mixRotation: 0,
          mixScale: 0,
          mixShear: 0,
          order: 0,
        },
      ],
      skins: [{ name: 'default', attachments: {} }],
      activeSkin: 'default',
    },
  };
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: 'doctor',
    name: 'Doctor',
    editor: { activeArtboardId: 'board', activeRigId: null },
    assetManifest: Object.fromEntries(
      ['image-a', 'image-b'].map((id) => [
        id,
        { source: 'embedded', dataUrl: `data:image/png;base64,${png}`, name: `${id}.png` },
      ]),
    ),
    components: [
      { id: 'component', name: 'Character', revision: 1, width: 100, height: 100, nodes: [rig], exposed: [] },
    ],
    artboards: [
      {
        id: 'board',
        name: 'Board',
        width: 300,
        height: 100,
        nodes: ['first', 'second'].map((id) => ({
          id,
          name: id,
          type: 'instance',
          parentId: null,
          transform: sceneTransform(),
          visible: id === 'first',
          opacity: 1,
          width: 100,
          height: 100,
          componentId: 'component',
          overrides: {},
        })),
      },
    ],
  };
}
const asset = (program?: RuntimeProgram) =>
  new NativeRuntimeAsset(program ?? compileRuntime(source()).program);
describe('native Ship Doctor inventory and warning budgets', () => {
  it('counts repeated component rigs, all variants and shared geometry without changing source/asset', () => {
    const original = source(),
      before = JSON.stringify(original),
      published = new NativeRuntimeAsset(compileRuntime(original).program),
      saved = JSON.stringify(published.getProgram());
    const report = inspectRuntimeInventory(published);
    expect(report.artboards[0]!.metrics).toEqual({
      nodes: 4,
      rigs: 2,
      bones: 4,
      slots: 6,
      constraints: 2,
      vertices: 20,
      weightedVertexTransforms: 12,
      triangles: 6,
      clippingVertices: 6,
      maxInfluences: 2,
      animationTimelines: 0,
    });
    expect(report.resources).toEqual({
      logicalTextures: 2,
      physicalTextures: 2,
      atlasPages: 0,
      textureDimension: 1,
      textureBytes: 8,
      encodedTextureBytes: atob(png).length * 2,
      fonts: 0,
      encodedFontBytes: 0,
    });
    expect(report.diagnostics).toEqual([]);
    report.artboards[0]!.metrics.bones = 99;
    report.budget.limits.bones = 99;
    expect(inspectRuntimeInventory(published).artboards[0]!.metrics.bones).toBe(4);
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.stringify(published.getProgram())).toBe(saved);
  });
  it('counts shared packed pages once and gives precise budget findings/remedies', () => {
    const pixels = readFileSync(new URL('../../../fixtures/ui-rtl-v1.png', import.meta.url)),
      width = pixels.readUInt32BE(16),
      height = pixels.readUInt32BE(20);
    const prepared = compilePackedRuntime(source(), {
      pages: [
        {
          id: 'page',
          mime: 'image/png',
          base64: pixels.toString('base64'),
          width,
          height,
          padding: 0,
          premultiplied: false,
        },
      ],
      textures: ['image-a', 'image-b'].map((id, index) => ({
        id,
        type: 'atlas',
        pageId: 'page',
        sourceWidth: 1,
        sourceHeight: 1,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        frame: { x: index, y: 0, width: 1, height: 1 },
        rotated: false,
        scale: 1,
        empty: false,
      })),
    });
    const report = inspectRuntimeInventory(
      asset(prepared.program),
      createRuntimeBudget('custom', {
        atlasPages: 0,
        textureDimension: 0,
        textureBytes: 0,
        bones: 3,
      }),
    );
    expect(report.resources).toMatchObject({
      logicalTextures: 2,
      physicalTextures: 1,
      atlasPages: 1,
      textureDimension: Math.max(width, height),
      textureBytes: width * height * 4,
      encodedTextureBytes: pixels.length,
    });
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BUDGET_ATLAS_PAGES', objectId: 'doctor', severity: 'warning' }),
        expect.objectContaining({ code: 'BUDGET_TEXTURE_DIMENSION', objectId: 'page' }),
        expect.objectContaining({ code: 'BUDGET_TEXTURE_BYTES', objectId: 'doctor' }),
        expect.objectContaining({ code: 'BUDGET_BONES', objectId: 'board' }),
      ]),
    );
    expect(report.diagnostics.every((d) => d.remedy.length > 0)).toBe(true);
  });
  it('preserves unknown memory on a malformed header and provides its object-specific error', () => {
    const program = compileRuntime(source()).program;
    const image = program.textures.find((t) => t.type === 'image')!;
    const damaged = new Uint8Array(33);
    damaged.set([137, 80, 78, 71, 13, 10, 26, 10]);
    image.base64 = btoa(String.fromCharCode(...damaged));
    const report = inspectRuntimeInventory(asset(program));
    expect(report.resources.textureBytes).toBe(null);
    expect(report.resources.textureDimension).toBe(null);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'IMAGE_HEADER',
        severity: 'error',
        objectId: image.id,
        remedy: expect.any(String),
      }),
    );
    expect(report.diagnostics.some((d) => d.code === 'BUDGET_TEXTURE_BYTES')).toBe(false);
  });
  it('owns complete presets/custom values and retains exact equality/unmeasured boundaries', () => {
    for (const preset of ['mobile-low', 'mobile-high', 'desktop', 'web', 'custom'] as const) {
      const budget = createRuntimeBudget(preset);
      expect(Object.keys(budget.limits)).toEqual([...RUNTIME_BUDGET_KEYS]);
      budget.limits.drawCalls = 999;
      expect(createRuntimeBudget(preset).limits.drawCalls).not.toBe(999);
    }
    const budget = createRuntimeBudget('custom', { bones: 4, maxInfluences: 1, updateP95Ms: 0.5 });
    expect(
      checkRuntimeBudget(
        { bones: 4, drawCalls: null, activeTracks: undefined, updateP95Ms: 0.5 },
        budget,
        'board',
        'frame',
      ),
    ).toEqual([]);
    const findings = inspectRuntimeInventory(asset(), budget).diagnostics;
    expect(findings.filter((d) => d.code === 'BUDGET_MAX_INFLUENCES')).toHaveLength(2);
    expect(findings.every((d) => d.objectId === 'mesh' && d.severity === 'warning' && d.remedy)).toBe(true);
    const input = { ...budget, limits: { ...budget.limits } },
      owned = validateRuntimeBudget(input);
    input.limits.bones = 0;
    expect(owned.limits.bones).toBe(4);
    const warning = checkRuntimeBudget({ updateP95Ms: 0.6 }, owned, 'board', 'profile')[0]!;
    expect(warning).toMatchObject({
      code: 'BUDGET_UPDATE_P95_MS',
      actual: 0.6,
      limit: 0.5,
      scope: 'profile',
    });
  });
  it('rejects incomplete/invalid policies and fabricated work measurements with coded remedies', () => {
    const budget = createRuntimeBudget();
    for (const bad of [
      null,
      [],
      { ...budget, extra: true },
      { ...budget, limits: {} },
      { ...budget, preset: '__proto__' },
      { ...budget, limits: { ...budget.limits, bones: -1 } },
      { ...budget, limits: { ...budget.limits, bones: 1.2 } },
      { ...budget, limits: { ...budget.limits, drawCalls: Infinity } },
      { ...budget, limits: { ...budget.limits, textureBytes: Number.MAX_SAFE_INTEGER + 1 } },
    ])
      expect(() => validateRuntimeBudget(bad)).toThrow(RuntimeFormatError);
    for (const bad of [{ drawCalls: NaN }, { vertices: -1 }, { activeTracks: 1.5 }, { fps: 60 }, null, []]) {
      expect(() => checkRuntimeBudget(bad as never, budget, 'board', 'frame')).toThrow(RuntimeFormatError);
    }
    expect(() => createRuntimeBudget('invalid' as never)).toThrow(RuntimeFormatError);
    expect(() =>
      validateRuntimeBudget({
        ...budget,
        limits: { ...budget.limits, bones: null },
      } as unknown as RuntimeBudget),
    ).toThrow(RuntimeFormatError);
  });
});
