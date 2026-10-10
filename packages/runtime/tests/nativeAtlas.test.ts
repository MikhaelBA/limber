import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deserializeProject, type BoneByBoneProject } from '@limber/core';
import {
  compilePackedRuntime,
  encodeRuntime,
  loadRuntime,
  serializeRuntime,
  validateRuntimeProgram,
  runtimeTextureRequirements,
  NativeRuntimeAsset,
  NativeArtboardPlayer,
  RuntimeFormatError,
  type RuntimeAtlasTexture,
  type RuntimeAtlasPage,
  type RuntimeProgram,
} from '@limber/runtime';

const base64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const source = () =>
  deserializeProject(
    readFileSync(new URL('../../../fixtures/bbbproj-v2-motion.json', import.meta.url), 'utf8'),
  );
const region = (): RuntimeAtlasTexture => ({
  id: 'white',
  type: 'atlas',
  pageId: 'page',
  sourceWidth: 38,
  sourceHeight: 26,
  crop: { x: 2, y: 3, width: 1, height: 1 },
  frame: { x: 0, y: 0, width: 1, height: 1 },
  rotated: false,
  scale: 1,
  empty: false,
});
const page = (): RuntimeAtlasPage => ({
  id: 'page',
  mime: 'image/png',
  base64,
  width: 1,
  height: 1,
  padding: 0,
  premultiplied: false,
});
const program = (project = source()) =>
  compilePackedRuntime(project, { textures: [region()], pages: [page()] }).program;
const reject = (p: RuntimeProgram, code: string, id?: string) => {
  try {
    validateRuntimeProgram(p);
    throw new Error('Expected rejection.');
  } catch (e) {
    expect(e).toBeInstanceOf(RuntimeFormatError);
    expect((e as RuntimeFormatError).diagnostic.code).toBe(code);
    if (id) expect((e as RuntimeFormatError).diagnostic.objectId).toBe(id);
  }
};
function twoImages(): BoneByBoneProject {
  const p = source(),
    image = p.artboards[0]!.nodes.find((n) => n.type === 'image')!;
  if (image.type !== 'image') throw new Error('Expected source image.');
  p.artboards[0]!.nodes.push({ ...structuredClone(image), id: 'another-image', textureId: 'second' });
  p.assetManifest.second = structuredClone(p.assetManifest.white!);
  return p;
}

describe('native packed atlas contract', () => {
  it('round-trips shared physical pixels once without embedding source image/editor metadata', () => {
    const p = source(),
      before = structuredClone(p),
      packed = program(p);
    expect(loadRuntime(encodeRuntime(packed))).toEqual(packed);
    expect(loadRuntime(serializeRuntime(packed, { pretty: true }))).toEqual(packed);
    expect(packed.features[0]).toBe('atlas');
    expect(packed.atlasPages).toHaveLength(1);
    expect(packed.textures[0]).toEqual(region());
    expect(serializeRuntime(packed).split(base64)).toHaveLength(2);
    expect(serializeRuntime(packed)).not.toContain('image/svg+xml');
    expect(p).toEqual(before);
    const player = new NativeArtboardPlayer(new NativeRuntimeAsset(packed));
    expect(player.getView().nodes).toHaveLength(p.artboards[0]!.nodes.length);
    expect(runtimeTextureRequirements({ artboards: p.artboards, components: [] })).toEqual([
      { id: 'white', trimAllowed: true },
    ]);
  });
  it('detaches nested region publications and page pixels from validated assets', () => {
    const input = program(),
      asset = new NativeRuntimeAsset(input);
    const texture = asset.getTexture('white');
    if (texture.type !== 'atlas') throw new Error('Expected atlas region.');
    texture.crop.x = texture.frame.x = 99;
    const all = asset.getTextures();
    if (all[0]!.type !== 'atlas') throw new Error('Expected atlas region.');
    all[0]!.crop.width = 99;
    const pages = asset.getAtlasPages();
    pages[0]!.base64 = '';
    input.atlasPages[0]!.width = 99;
    expect(asset.getTexture('white')).toEqual(region());
    expect(asset.getAtlasPages()).toEqual([page()]);
  });
  it('rejects missing/duplicate/unused page identities and a stale feature manifest', () => {
    let p = program();
    p.atlasPages = [];
    reject(p, 'MISSING_ATLAS_PAGE', 'white');
    p = program();
    p.atlasPages.push(page());
    reject(p, 'DUPLICATE_ATLAS_PAGE', 'page');
    p = program();
    p.atlasPages.push({ ...page(), id: 'unused' });
    reject(p, 'UNUSED_ATLAS_PAGE', 'unused');
    p = program();
    p.features = p.features.filter((f) => f !== 'atlas');
    reject(p, 'FEATURE_MISMATCH');
  });
  it('checks crop/scale/empty/source bounds before constructing playback', () => {
    for (const change of [
      { crop: { x: 38, y: 0, width: 1, height: 1 } },
      { scale: 0 },
      { scale: 17 },
      { empty: true },
    ]) {
      const p = program();
      Object.assign(p.textures[0]!, change);
      reject(p, 'INVALID_ATLAS_CROP', 'white');
    }
    const p = program();
    Object.assign(p.textures[0]!, { sourceWidth: 0 });
    reject(p, 'ATLAS_INVALID_INPUT', 'white');
  });
  it('checks PNG dimensions, placement orientation, bounds, padding and unknown pixel declarations', () => {
    let p = program();
    p.atlasPages[0]!.width = 2;
    reject(p, 'INVALID_ATLAS_DIMENSIONS', 'page');
    p = program();
    Object.assign(p.textures[0]!, { frame: { x: 0, y: 0, width: 2, height: 1 } });
    reject(p, 'ATLAS_INVALID_LAYOUT', 'white');
    p = program();
    p.atlasPages[0]!.padding = 1;
    reject(p, 'ATLAS_INVALID_LAYOUT', 'white');
    p = program();
    Object.assign(p.atlasPages[0]!, { premultiplied: true });
    reject(p, 'INVALID_STRUCTURE', 'page');
    p = program();
    Object.assign(p.textures[0]!, { base64 });
    reject(p, 'UNKNOWN_FIELD', 'white');
  });
  it('rejects overlapping shared frames and omitted or unreferenced logical images', () => {
    const p = twoImages();
    expect(() =>
      compilePackedRuntime(p, { textures: [region(), { ...region(), id: 'second' }], pages: [page()] }),
    ).toThrow(/overlap/);
    expect(() => compilePackedRuntime(p, { textures: [region()], pages: [page()] })).toThrow(
      /shipping pixels/,
    );
    const extra = program();
    extra.textures.push({ id: 'unused', type: 'image', mime: 'image/png', base64 });
    reject(extra, 'UNUSED_ASSET', 'unused');
  });
  it('locks full-domain users while allowing scale without rewriting logical geometry or UVs', () => {
    const p = source(),
      image = p.artboards[0]!.nodes.find((n) => n.type === 'image')!;
    if (image.type !== 'image') throw new Error('Expected source image.');
    p.artboards[0]!.nodes = [
      {
        ...image,
        type: 'nineSlice',
        sourceWidth: 38,
        sourceHeight: 26,
        borders: { left: 1, right: 1, top: 1, bottom: 1 },
      },
    ];
    p.artboards[0]!.clips = [];
    expect(runtimeTextureRequirements({ artboards: p.artboards, components: [] })).toEqual([
      { id: 'white', trimAllowed: false },
    ]);
    expect(() => program(p)).toThrow(/full logical UV/);
    const before = structuredClone(p);
    const packed = compilePackedRuntime(p, {
      textures: [{ ...region(), crop: { x: 0, y: 0, width: 38, height: 26 }, scale: 1 / 38 }],
      pages: [page()],
    }).program;
    expect(packed.artboards[0]!.nodes).toEqual(p.artboards[0]!.nodes);
    expect(p).toEqual(before);
    const rig = deserializeProject(
      readFileSync(new URL('../../../fixtures/bbbproj-v1-demo.json', import.meta.url), 'utf8'),
    );
    expect(
      runtimeTextureRequirements({ artboards: rig.artboards, components: [] }).every((r) => !r.trimAllowed),
    ).toBe(true);
  });
  it('allows independently embedded images beside packed regions with separate page/texture namespaces', () => {
    const p = twoImages();
    const packed = compilePackedRuntime(p, {
      textures: [region(), { id: 'second', type: 'image', mime: 'image/png', base64 }],
      pages: [page()],
    }).program;
    expect(loadRuntime(encodeRuntime(packed)).textures.map((t) => t.type)).toEqual(['image', 'atlas']);
    const sameName = page();
    sameName.id = 'white';
    expect(
      compilePackedRuntime(source(), { textures: [{ ...region(), pageId: 'white' }], pages: [sameName] })
        .program.atlasPages[0]!.id,
    ).toBe('white');
  });
});
