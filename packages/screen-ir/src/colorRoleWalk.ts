// The one test for "this widget tree carries a color role". stampSchemaVersion()
// and validate()'s `color-role-version` rule both use it, so a document stamped
// '1.0' never fails that rule. Internal: not exported from the index.

import { isRecord } from './guards.js';

/**
 * Whether `node`, or any widget under it, holds a ColorRole in its props at any
 * depth or at a rule position (a rule's `default` or a condition's `value`).
 * Matches `carries_color_role` in canopy-spec's `tools/check.py`.
 *
 * Accepts any value: a part that is not the expected object or array is skipped,
 * so a document that has not passed the schema can be walked without throwing.
 */
export function carriesColorRole(node: unknown): boolean {
  if (!isRecord(node)) return false;
  // The props bag's own keys are prop names, so a bag such as
  // `{ "$role": "x", "fallback": "#000000" }` is two ordinary props: look only
  // at its values.
  const props = node['props'];
  if (isRecord(props) && Object.values(props).some(hasRole)) return true;
  for (const rule of arrayOrEmpty(node['rules'])) {
    if (!isRecord(rule)) continue;
    if (hasRole(rule['default'])) return true;
    if (arrayOrEmpty(rule['conditions']).some((c) => isRecord(c) && hasRole(c['value']))) {
      return true;
    }
  }
  return arrayOrEmpty(node['children']).some(carriesColorRole);
}

/**
 * Whether `value` is, or contains at any depth, an object with a `$role` key. On
 * a schema-valid document every such object at these positions is a ColorRole,
 * so this matches canopy-spec's reference checker without re-checking its shape.
 */
function hasRole(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRole);
  if (typeof value !== 'object' || value === null) return false;
  return '$role' in value || Object.values(value).some(hasRole);
}

function arrayOrEmpty(x: unknown): readonly unknown[] {
  return Array.isArray(x) ? x : [];
}
