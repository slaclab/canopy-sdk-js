/** Internal type guards shared by the readers in this package; not exported from the index. */

/** True when `x` is a plain object (not `null`, not an array). */
export function isRecord(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
