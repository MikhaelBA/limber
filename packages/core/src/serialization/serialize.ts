import { FORMAT_VERSION } from '../types/data';
import type { EditorDocument, ExportedDocument } from '../types/document';
import { runMigrations, type Migration } from './migrations';

/**
 * migrations[i] upgrades a document from version i+1 to i+2.
 * Version 1 is the first format — the chain is empty until v2 exists.
 */
const CURRENT_MIGRATIONS: readonly Migration[] = [];

export function serializeDocument(doc: EditorDocument): string {
  const exported: ExportedDocument = { version: FORMAT_VERSION, ...doc };
  return JSON.stringify(exported, null, 2);
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
