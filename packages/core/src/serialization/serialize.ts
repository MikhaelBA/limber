import { FORMAT_VERSION } from '../types/data';
import type { EditorDocument, ExportedDocument } from '../types/document';
import { runMigrations, type Migration } from './migrations';
import { validateDeformTimelines } from '../animation/validateDeforms';
import { validateAnimationEvents } from '../animation/eventPayload';
import { meshJSONReplacer } from '../skeleton/meshLinks';

/**
 * migrations[i] upgrades a document from version i+1 to i+2.
 * v1→v2 is additive only (optional AttachmentData.meshHull): pre-v2 meshes are
 * exactly the "every vertex is a hull vertex" case, so nothing to rewrite.
 */
const CURRENT_MIGRATIONS: readonly Migration[] = [
  (doc) => doc, // v1 → v2: meshHull optional; absent means all-hull.
];

export function serializeDocument(doc: EditorDocument): string {
  const exported: ExportedDocument = { version: FORMAT_VERSION, ...doc };
  return JSON.stringify(exported, meshJSONReplacer, 2);
}

export function deserializeDocument(json: string): EditorDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`Not a valid JSON document: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Document must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== 'number') {
    throw new Error('Document is missing a numeric "version" field.');
  }
  if (obj.version > FORMAT_VERSION) {
    throw new Error(
      `Document version ${obj.version} is newer than the supported version ${FORMAT_VERSION}. ` +
        'It was probably saved by a newer Limber — update and try again.',
    );
  }

  const migrated = runMigrations(obj, CURRENT_MIGRATIONS, FORMAT_VERSION);
  assertCoarseShape(migrated);

  const { version: _version, ...doc } = migrated;
  const typed = doc as unknown as EditorDocument;
  validateDeformTimelines(typed.skeleton, typed.animations);
  validateAnimationEvents(typed.animations);
  return doc as unknown as EditorDocument;
}

/** Coarse shape check only — deep structural validation happens in `new Skeleton(...)`. */
function assertCoarseShape(doc: Record<string, unknown>): void {
  const skeleton = doc.skeleton;
  if (typeof skeleton !== 'object' || skeleton === null) {
    throw new Error('Document is missing the "skeleton" object.');
  }
  for (const field of ['bones', 'slots', 'attachments', 'ikConstraints', 'skins'] as const) {
    if (!Array.isArray((skeleton as Record<string, unknown>)[field])) {
      throw new Error(`Document skeleton is missing the "${field}" array.`);
    }
  }
  if (!Array.isArray(doc.animations)) {
    throw new Error('Document is missing the "animations" array.');
  }
  if (typeof doc.assetManifest !== 'object' || doc.assetManifest === null) {
    throw new Error('Document is missing the "assetManifest" object.');
  }
}
