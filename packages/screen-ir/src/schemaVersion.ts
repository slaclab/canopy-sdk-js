import { isColorRole } from './colorRole.js';
import type { SchemaVersion } from './screen.js';

/**
 * Every Screen IR version this package reads and validates. `1.1` is `1.0` plus
 * {@link ColorRole} values; a document without any role stays `1.0` so older
 * readers keep accepting it.
 */
export const SUPPORTED_SCHEMA_VERSIONS = ['1.0', '1.1'] as const;

const SUPPORTED: ReadonlySet<unknown> = new Set<unknown>(SUPPORTED_SCHEMA_VERSIONS);

/** Type guard: true when `v` is one of {@link SUPPORTED_SCHEMA_VERSIONS}. */
export function isSupportedSchemaVersion(v: unknown): v is SchemaVersion {
  return SUPPORTED.has(v);
}

function containsColorRole(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  if (isColorRole(node)) return true;
  const values: readonly unknown[] = Array.isArray(node) ? node : Object.values(node);
  return values.some(containsColorRole);
}

/**
 * The lowest schema version that can carry `doc`: `'1.1'` when a deep walk of
 * the document (props at any depth such as `curves[].color`, rule condition
 * values, rule defaults, child widgets) finds a {@link ColorRole}, otherwise
 * `'1.0'`. The document's own `schemaVersion` field is ignored. Embedded
 * documents are separate files and are stamped on their own.
 */
export function stampSchemaVersion(doc: unknown): SchemaVersion {
  return containsColorRole(doc) ? '1.1' : '1.0';
}
