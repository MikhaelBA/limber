import { readFileSync } from 'node:fs';
// Node/browser fixture harnesses cannot import the TypeScript model directly.
// Keep their expected current header tied to its single authoritative constant.
const model = readFileSync(new URL('../packages/core/src/project/model.ts', import.meta.url), 'utf8');
const version = model.match(/export const PROJECT_SCHEMA_VERSION = (\d+);/);
if (!version) throw new Error('Cannot read the current project schema constant.');
export const CURRENT_SOURCE_SCHEMA = Number(version[1]);
