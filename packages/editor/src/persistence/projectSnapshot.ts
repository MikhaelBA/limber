import { validateProject, type BoneByBoneProject } from '@limber/core';

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Project snapshot cancelled.', 'AbortError');
};
async function encodeBlob(blob: Blob, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const finish = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        reader.abort();
        finish();
        reject(new DOMException('Project snapshot cancelled.', 'AbortError'));
      };
      reader.onload = () => {
        finish();
        resolve(String(reader.result));
      };
      reader.onerror = () => {
        finish();
        reject(reader.error ?? new Error('Texture encoding failed.'));
      };
      reader.onabort = () => {
        finish();
        reject(new DOMException('Project snapshot cancelled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      reader.readAsDataURL(blob);
    });
  }
  // Node contract tests use the same immutable Blob bytes without requiring browser globals.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  checkAbort(signal);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** Capture model and immutable Blob references before any await; async encoding cannot mix edits. */
export async function captureProjectSnapshot(
  source: BoneByBoneProject,
  textures: readonly { textureId: string; blob: Blob }[],
  options: { signal?: AbortSignal } = {},
): Promise<{ project: BoneByBoneProject; embedded: number }> {
  checkAbort(options.signal);
  const project = structuredClone(source),
    blobs = new Map(textures.map((entry) => [entry.textureId, entry.blob]));
  let embedded = 0;
  for (const [id, metadata] of Object.entries(project.assetManifest)) {
    const blob = blobs.get(id);
    if (!blob) continue;
    metadata.dataUrl = await encodeBlob(blob, options.signal);
    embedded++;
  }
  // Validate the captured publication, including font bytes/metadata, before Save or worker dispatch.
  checkAbort(options.signal);
  validateProject(project);
  return { project, embedded };
}

export function downloadProjectArtifact(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Navigation/download consumption is asynchronous; retain bytes through that dispatch.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
