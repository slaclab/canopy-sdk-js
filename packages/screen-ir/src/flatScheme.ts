import { isRecord } from './guards.js';

/**
 * Metadata that travels with a flattened color scheme. The same shape is produced
 * by the pydm `load_scheme` flattener and served in `/config.json`'s
 * `colorScheme.meta`.
 *
 * `id` and `sha256` are `null` when no scheme file was loaded. `served` names the
 * scheme actually in effect, and `errors` lists the problems that made the server
 * fall back (empty on a clean load).
 */
export interface SchemeMeta {
  readonly id: string | null;
  readonly sha256: string | null;
  readonly flatHash: string;
  readonly served: string;
  readonly errors: readonly SchemeError[];
}

/** One problem found while loading a scheme: a JSON-pointer-like `path` and a message. */
export interface SchemeError {
  readonly path: string;
  readonly message: string;
}

/**
 * A color scheme flattened to parallel arrays: `light[i]` and `dark[i]` are the
 * colors of role `roles[i]`. Colors are canonical lowercase `#rrggbb`, or
 * `#rrggbbaa` when the alpha is not `ff`.
 */
export interface FlatScheme {
  readonly roles: readonly string[];
  readonly light: readonly string[];
  readonly dark: readonly string[];
  readonly meta: SchemeMeta;
}

/** The scheme id the server serves when it falls back. */
export const CANOPY_DEFAULT_SCHEME_ID = 'canopy-default';

const CANONICAL_HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const ROLE_MAX_LENGTH = 64;

function isCanonicalHex(x: unknown): x is string {
  return typeof x === 'string' && CANONICAL_HEX.test(x) && !(x.length === 9 && x.endsWith('ff'));
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function parseMeta(x: unknown): SchemeMeta | string {
  if (!isRecord(x)) return 'meta must be an object';
  const { id, sha256, flatHash, served, errors } = x;
  if (id !== null && typeof id !== 'string') return 'meta.id must be a string or null';
  if (sha256 !== null && typeof sha256 !== 'string') return 'meta.sha256 must be a string or null';
  if (typeof flatHash !== 'string') return 'meta.flatHash must be a string';
  if (typeof served !== 'string') return 'meta.served must be a string';
  if (!Array.isArray(errors)) return 'meta.errors must be an array';
  const parsed: SchemeError[] = [];
  for (const [i, e] of errors.entries()) {
    if (!isRecord(e) || typeof e['path'] !== 'string' || typeof e['message'] !== 'string') {
      return `meta.errors[${i}] must be {path: string, message: string}`;
    }
    parsed.push({ path: e['path'], message: e['message'] });
  }
  return { id, sha256, flatHash, served, errors: parsed };
}

function checkColors(name: 'light' | 'dark', colors: readonly string[]): string | null {
  for (const [i, c] of colors.entries()) {
    if (!isCanonicalHex(c)) {
      return `${name}[${i}] ${JSON.stringify(c)} is not a canonical lowercase #rrggbb or #rrggbbaa color (no ff alpha)`;
    }
  }
  return null;
}

/**
 * Validate an untrusted value as a {@link FlatScheme}. Returns a fresh scheme
 * holding only the known fields, or `{error}` naming the first failed check:
 * `roles`, `light` and `dark` must be string arrays of equal length; role names
 * must be unique, 1–64 characters; colors must be canonical (lowercase, 6 or 8
 * hex digits, no `ff` alpha); and `meta` must be a {@link SchemeMeta} (with
 * nullable `id` and `sha256`).
 */
export function parseFlatScheme(x: unknown): FlatScheme | { error: string } {
  if (!isRecord(x)) return { error: 'scheme must be an object' };
  const { roles, light, dark } = x;
  if (!isStringArray(roles)) return { error: 'roles must be an array of strings' };
  if (!isStringArray(light)) return { error: 'light must be an array of strings' };
  if (!isStringArray(dark)) return { error: 'dark must be an array of strings' };
  if (light.length !== roles.length || dark.length !== roles.length) {
    return {
      error: `roles, light and dark must have equal length (got ${roles.length}, ${light.length}, ${dark.length})`,
    };
  }
  const seen = new Set<string>();
  for (const [i, role] of roles.entries()) {
    if (role.length < 1 || role.length > ROLE_MAX_LENGTH) {
      return { error: `roles[${i}] must be 1-${ROLE_MAX_LENGTH} characters` };
    }
    if (seen.has(role)) return { error: `duplicate role ${JSON.stringify(role)}` };
    seen.add(role);
  }
  const colorError = checkColors('light', light) ?? checkColors('dark', dark);
  if (colorError !== null) return { error: colorError };
  const meta = parseMeta(x['meta']);
  if (typeof meta === 'string') return { error: meta };
  return { roles: [...roles], light: [...light], dark: [...dark], meta };
}

/**
 * True when the server fell back to the built-in default scheme because the
 * configured one failed to load: `served` is `canopy-default` and `errors` is
 * non-empty. `id` is not consulted — it is `null` when no file could be read at all.
 */
export function isServerFallback(meta: SchemeMeta): boolean {
  return meta.served === CANOPY_DEFAULT_SCHEME_ID && meta.errors.length > 0;
}
