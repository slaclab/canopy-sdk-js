import { isRecord } from './guards.js';

/**
 * A themeable color reference: a legal value wherever a widget property holds a
 * color, at any depth (`foregroundColor`, `curves[].color`), and at rule positions
 * (a condition `value` or a conditional rule's `default`).
 *
 * `$role` names a color role the viewer's theme resolves (for example
 * `"alarm.major"`). When the theme does not define the role, the viewer uses
 * `fallback`, or `fallbackDark` under a dark theme when it is present. Fallbacks
 * are `#rrggbb` or `#rrggbbaa` hex strings.
 */
export interface ColorRole {
  readonly $role: string;
  readonly fallback: string;
  readonly fallbackDark?: string;
}

const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ROLE_MAX_LENGTH = 64;
const COLOR_ROLE_KEYS: ReadonlySet<string> = new Set(['$role', 'fallback', 'fallbackDark']);

function isHexColor(x: unknown): boolean {
  return typeof x === 'string' && HEX_COLOR.test(x);
}

/**
 * Type guard: true when `x` is a well-formed {@link ColorRole} — a 1–64 character
 * `$role`, hex `fallback`/`fallbackDark`, and no other keys (matching the schema's
 * `$defs/ColorRole`).
 */
export function isColorRole(x: unknown): x is ColorRole {
  if (!isRecord(x)) return false;
  for (const key of Object.keys(x)) {
    if (!COLOR_ROLE_KEYS.has(key)) return false;
  }
  const role = x['$role'];
  if (typeof role !== 'string' || role.length < 1 || role.length > ROLE_MAX_LENGTH) return false;
  if (!isHexColor(x['fallback'])) return false;
  return !('fallbackDark' in x) || isHexColor(x['fallbackDark']);
}
