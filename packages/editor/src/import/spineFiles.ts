import { importSpineJson, parseSpineAtlas, projectFromLegacy, type BoneByBoneProject } from '@limber/core';

export interface SpineFiles {
  json: string;
  name: string;
  files: File[];
}
export async function readSpineFiles(files: File[]): Promise<SpineFiles> {
  if (files.some((f) => /\.(spine|skel)$/i.test(f.name)))
    throw new Error(
      'Choose a Spine 4.2 JSON export, atlas and images. Original .spine projects and binary .skel exports are not supported yet.',
    );
  const json = files.filter((f) => /\.json$/i.test(f.name));
  if (json.length !== 1)
    throw new Error(
      'Select exactly one skeleton JSON, plus its atlas and all page images (or individual images).',
    );
  return { json: await json[0]!.text(), name: json[0]!.name.replace(/\.json$/i, ''), files };
}
const path = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
function imageFile(files: File[], wanted: string): File {
  const candidates = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
  const exact = candidates.filter((f) => path(f.webkitRelativePath || f.name) === path(wanted));
  const matches = exact.length
    ? exact
    : candidates.filter((f) => path(f.name).split('/').pop() === path(wanted).split('/').pop());
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Ambiguous image "${wanted}"; use unique file names.`
        : `Missing image "${wanted}". Select the JSON, atlas and all images together.`,
    );
  return matches[0]!;
}
async function bitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error(`Could not decode "${file.name}".`);
  }
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not embed imported image.'));
    reader.readAsDataURL(blob);
  });
}
async function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode imported atlas region.'))),
      'image/png',
    ),
  );
}

/** Prepare and validate every local image before touching the open project. */
export async function prepareSpineProject(input: SpineFiles, skin: string): Promise<BoneByBoneProject> {
  const imported = importSpineJson(input.json, skin);
  const atlases = input.files.filter((f) => /\.(atlas|txt)$/i.test(f.name));
  if (atlases.length > 1) throw new Error('Select one atlas file; it may contain multiple pages.');
  const regions = atlases.length ? parseSpineAtlas(await atlases[0]!.text()) : null;
  const pages = new Map<string, ImageBitmap>();
  try {
    for (const [id, image] of imported.images) {
      let blob: Blob;
      if (!regions) {
        const name = /\.(png|jpe?g|webp)$/i.test(image) ? image : `${image}.png`;
        const file = imageFile(input.files, name),
          decoded = await bitmap(file);
        decoded.close();
        blob = file;
      } else {
        const region = regions.find((r) => r.name === image);
        if (!region) throw new Error(`Missing atlas region "${image}".`);
        let page = pages.get(region.page);
        if (!page) {
          page = await bitmap(imageFile(input.files, region.page));
          pages.set(region.page, page);
        }
        const rotated = region.rotation === 90 || region.rotation === 270;
        const packedWidth = rotated ? region.height : region.width,
          packedHeight = rotated ? region.width : region.height;
        if (region.x + packedWidth > page.width || region.y + packedHeight > page.height)
          throw new Error(`Atlas region "${image}" leaves page "${region.page}".`);
        if (region.originalWidth * region.originalHeight > 16_777_216)
          throw new Error(`Atlas region "${image}" exceeds the import image limit.`);
        const canvas = document.createElement('canvas');
        canvas.width = region.originalWidth;
        canvas.height = region.originalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable.');
        ctx.imageSmoothingEnabled = false;
        const x = region.offsetX,
          y = region.originalHeight - region.offsetY - region.height;
        ctx.translate(x, y);
        if (region.rotation === 90) {
          ctx.translate(region.width, 0);
          ctx.rotate(Math.PI / 2);
        } else if (region.rotation === 180) {
          ctx.translate(region.width, region.height);
          ctx.rotate(Math.PI);
        } else if (region.rotation === 270) {
          ctx.translate(0, region.height);
          ctx.rotate(-Math.PI / 2);
        }
        ctx.drawImage(page, region.x, region.y, packedWidth, packedHeight, 0, 0, packedWidth, packedHeight);
        if (region.pma) {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < pixels.data.length; i += 4) {
            const alpha = pixels.data[i + 3]!;
            if (alpha > 0 && alpha < 255)
              for (let k = 0; k < 3; k++)
                pixels.data[i + k] = Math.min(255, Math.round((pixels.data[i + k]! * 255) / alpha));
          }
          ctx.putImageData(pixels, 0, 0);
        }
        blob = await png(canvas);
      }
      imported.document.assetManifest[id]!.dataUrl = await dataUrl(blob);
    }
    return projectFromLegacy(imported.document, input.name);
  } finally {
    for (const page of pages.values()) page.close();
  }
}
