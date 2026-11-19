import { carriesColorRole } from './colorRoleWalk.js';
import { isRecord } from './guards.js';
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

/**
 * The lowest schema version that can carry `doc`: `'1.1'` when `doc.root`, or
 * any widget under it, holds a color role in its props at any depth (such as
 * `curves[].color`, or `unknown-widget`'s `originalProps`) or at a rule position
 * (a rule's `default` or a condition's `value`), otherwise `'1.0'`.
 *
 * This is the walk `validate()`'s `color-role-version` rule makes, so a document
 * stamped here never fails that rule. Like the rule, it looks for the reserved
 * `$role` key and does not check the role's shape: a malformed role still stamps
 * `'1.1'`, and `validate()` reports it as a schema error. The props bag's own
 * keys are prop names, never a role, and the document's other fields
 * (`metadata`, `macros`, `formulas`) are not walked.
 *
 * The document's own `schemaVersion` is ignored, so an unedited `'1.1'` document
 * without a role is stamped `'1.0'`. Input that is not an object is `'1.0'`.
 * Embedded documents are separate files and are stamped on their own.
 */
export function stampSchemaVersion(doc: unknown): SchemaVersion {
  return isRecord(doc) && carriesColorRole(doc['root']) ? '1.1' : '1.0';
}
