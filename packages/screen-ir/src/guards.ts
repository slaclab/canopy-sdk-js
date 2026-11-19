/** Internal type guards shared by the readers in this package; not exported from the index. */

/** True when `x` is a plain object (not `null`, not an array). */
export function isRecord(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * The length of `s` in Unicode code points, the unit JSON Schema's `minLength`
 * and `maxLength` count. `s.length` counts UTF-16 code units, so it counts a
 * character outside the Basic Multilingual Plane (an emoji, say) twice.
 */
export function codePointLength(s: string): number {
  return [...s].length;
}
