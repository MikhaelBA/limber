import { buildAtlasText, exportSpineJson, packAtlas, uniqueTexturePaths, type AtlasImageInput } from '@limber/core';
import type { EditorDocument } from '@limber/core';
import { textureRegistry } from '../engine/TextureRegistry';

/**
 * Spine export bundle: skeleton.json + atlas.png + atlas.txt, all sharing one
 * region-name mapping (`uniqueTexturePaths`). The packer and the atlas TEXT
 * live in core (pure, tested); this module only composites pixels via canvas
 * and is therefore browser-only.
 */

export interface SpineBundle {
  json: string;
  atlas: string;
  png: Blob | null; // null when the document has no packed textures.
}

export async function buildSpineBundle(doc: EditorDocument): Promise<SpineBundle> {
  const texturePaths = uniqueTexturePaths(doc.assetManifest);

  // Only textures whose pixels we still hold (dropped this session) get packed;
  // the rest keep their manifest-derived paths and pair with a user atlas.
  const entries: { textureId: string; path: string; blob: Blob }[] = [];
  for (const [textureId, name, blob] of textureRegistry.blobEntries().map((e) => [e.textureId, e.name, e.blob] as const)) {
    if (doc.assetManifest[textureId]) entries.push({ textureId, path: texturePaths.get(textureId)!, blob });
  }

  const json = exportSpineJson(doc, texturePaths);
  if (entries.length === 0) return { json, atlas: '', png: null };

  const images = await Promise.all(
    entries.map(async (e) => {
      const bmp = await createImageBitmap(e.blob);
      return { input: { name: e.path, width: bmp.width, height: bmp.height } satisfies AtlasImageInput, bmp };
    }),
  );

  const layout = packAtlas(images.map((i) => i.input), { padding: 2 });
  const atlas = buildAtlasText('atlas', layout);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable — cannot composite the atlas.');
  const byPath = new Map(images.map((i) => [i.input.name, i.bmp]));
  for (const p of layout.placements) {
    const bmp = byPath.get(p.name);
    if (bmp) ctx.drawImage(bmp, p.x, p.y);
  }
  const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!png) throw new Error('PNG encoding failed — cannot composite the atlas.');
  return { json, atlas, png };
}
