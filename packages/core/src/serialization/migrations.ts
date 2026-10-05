/**
 * Versioned migration runner (DESIGN.md §8.3).
 *
 * `migrations[i]` upgrades a document from version i+1 to i+2. The runner
 * applies them in order until the document reaches the target version.
 */

/** Mutable on purpose: migrations may reshape any part of the raw document. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

export function runMigrations(
  doc: Record<string, unknown>,
  migrations: readonly Migration[],
  targetVersion: number,
): Record<string, unknown> {
  let current = doc;
  let version = typeof current.version === 'number' ? current.version : -1;
  if (version < 1) {
    throw new Error(`Document has no valid version field (got ${String(current.version)}).`);
  }
  while (version < targetVersion) {
    const migrate = migrations[version - 1];
    if (!migrate) {
      throw new Error(`No migration path from version ${version} to ${version + 1}.`);
    }
    current = migrate(current);
    if (typeof current !== 'object' || current === null) {
      throw new Error(`Migration to version ${version + 1} returned a non-object document.`);
    }
    current.version = ++version;
  }
  return current;
}
