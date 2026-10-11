import { decodeWeights, encodeWeights } from '@limber/mesh';
import type { AttachmentData, PathData, PathSegment, SkeletonData } from '../types/data';
const cache = new WeakMap<PathData, AttachmentData>();

/** Live authoring adapter: paths retain their cubic source representation. */
export function pathWeightAttachment(path: PathData): AttachmentData {
  const existing = cache.get(path);
  if (existing) return existing;
  const view: AttachmentData = { id: path.id, name: path.name, type: 'mesh', textureId: '' };
  Object.defineProperties(view, {
    meshVertices: {
      get: () => path.segments.flat(),
      set: (vertices: number[]) => {
        path.segments = Array.from(
          { length: vertices.length / 8 },
          (_, i) => vertices.slice(i * 8, i * 8 + 8) as PathSegment,
        );
      },
    },
    meshHull: { get: () => [] },
    weightEdges: {
      get: () => Array.from({ length: path.segments.length * 4 - 1 }, (_, i) => [i, i + 1]).flat(),
    },
    weights: {
      get: () => path.weights,
      set: (weights: number[] | undefined) => {
        if (!weights) {
          delete path.weights;
          return;
        }
        const n = path.segments.length * 4;
        // Decode without needing a skeleton's index space; determine the maximum index safely.
        const boneCount = (encoded: number[]) => {
          let cursor = 0,
            max = 0;
          for (let v = 0; v < n; v++) {
            const length = encoded[cursor++]!;
            if (!Number.isInteger(length) || length < 0 || cursor + length * 2 > encoded.length)
              throw new Error('Malformed path weights.');
            for (let k = 0; k < length; k++) {
              max = Math.max(max, encoded[cursor++]!);
              cursor++;
            }
          }
          return max + 1;
        };
        const rows = decodeWeights(weights, n, boneCount(weights)),
          old = path.weights ? decodeWeights(path.weights, n, boneCount(path.weights)) : null;
        for (let segment = 1; segment < path.segments.length + (path.closed ? 1 : 0); segment++) {
          const start = (segment % path.segments.length) * 4,
            end = (segment - 1) * 4 + 3;
          const changedEnd = old && JSON.stringify(old[end]) !== JSON.stringify(rows[end]);
          const chosen = changedEnd ? rows[end]! : rows[start]!;
          rows[start] = chosen;
          rows[end] = chosen;
        }
        path.weights = encodeWeights(rows);
      },
    },
    boneBindings: {
      get: () => path.boneBindings,
      set: (value: PathData['boneBindings']) => {
        path.boneBindings = value;
      },
    },
    weightLocks: {
      get: () => path.weightLocks,
      set: (value: string[] | undefined) => {
        path.weightLocks = value;
      },
    },
  });
  cache.set(path, view);
  return view;
}
export function weightAttachment(data: SkeletonData, id: string): AttachmentData | undefined {
  const attachment = data.attachments.find((item) => item.id === id);
  if (attachment) return attachment;
  const path = data.paths?.find((item) => item.id === id);
  return path ? pathWeightAttachment(path) : undefined;
}
