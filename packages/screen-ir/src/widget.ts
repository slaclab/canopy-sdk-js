import type { ColorRole } from './colorRole.js';
import type { Rule } from './rules.js';
import { isRecord } from './guards.js';

/** Absolute pixel bounds in canvas coordinates. Absolute-only for v0.1. */
export interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Editor-facing annotations preserved across save; ignored by the runtime renderer. */
export interface WidgetMeta {
  readonly comment?: string;
}

/**
 * A widget property value: a JSON literal, or a {@link ColorRole} wherever the
 * property holds a color. An object carrying `$role` is a role and nothing else;
 * `validate()` rejects one that is not well-formed. Macro substitution is
 * detected via the widget's `propSchema`
 * (`format: "pv-channel" | "macro-string"`), not via the value.
 */
export type PropertyValue = PropertyLiteral | ColorRole | PropertyTagged;

export type PropertyLiteral =
  | string
  | number
  | boolean
  | null
  | readonly PropertyValue[]
  | { readonly [key: string]: PropertyValue };

/**
 * Reserved tagged form, detected by the leading `$` key prefix. `$role` is the
 * one tag in use, and {@link ColorRole} is its type.
 */
export interface PropertyTagged {
  readonly [key: `$${string}`]: unknown;
}

export type Props = Readonly<Record<string, PropertyValue>>;

/**
 * One widget in the IR tree.
 *
 * - `id` is stable across saves; never regenerate on round-trip.
 * - `type` is the Canopy widget registry id (kebab-case, e.g. `"pv-label"`), never a Qt class name.
 * - Z-order is array order of `children` — later siblings render on top.
 * - Rules are inline, attached by `targetProperty`.
 * - `unknown-widget` is the converter's fallback when a Qt class has no registry entry.
 */
export interface WidgetNode {
  readonly id: string;
  readonly type: string;
  readonly props: Props;
  readonly geometry: Geometry;
  readonly children?: readonly WidgetNode[];
  readonly rules?: readonly Rule[];
  readonly meta?: WidgetMeta;
  /** Converter warnings that survive into the IR; surfaced as inline indicators in SB. */
  readonly warnings?: readonly string[];
}

/**
 * Fallback type emitted by the converter for Qt classes with no registry entry.
 * Original Qt props are preserved verbatim under `originalProps` so nothing is lost.
 */
export interface UnknownWidgetProps {
  readonly originalClass: string;
  readonly originalProps: Readonly<Record<string, unknown>>;
}

/**
 * A widget action, carried in the reserved `props.actions` list.
 *
 * - `open_display` opens another screen; `target` chooses where it lands.
 * - `write_pv` writes a literal value to a PV.
 * - `execute` runs a shell command (the runtime may refuse it).
 * - `open_webpage` / `open_file` open a URL or a file.
 * - `close_display` closes the screen hosting the widget.
 *
 * {@link isAction} checks field types only; it does not judge whether an action is
 * safe to run. A runtime must refuse `execute` unless its deployment explicitly
 * enables it, and must reject an `open_webpage` `url` whose scheme is not `http:`
 * or `https:` (for example `javascript:`) before using it as a link.
 */
export type Action =
  | {
      readonly type: 'open_display';
      readonly file: string;
      readonly macros?: Readonly<Record<string, string>>;
      readonly target: 'replace' | 'tab' | 'window';
    }
  | { readonly type: 'write_pv'; readonly pvName: string; readonly value: string | number }
  | { readonly type: 'execute'; readonly command: string; readonly description?: string }
  | { readonly type: 'open_webpage'; readonly url: string }
  | { readonly type: 'open_file'; readonly file: string }
  | { readonly type: 'close_display' };

const OPEN_DISPLAY_TARGETS: ReadonlySet<unknown> = new Set(['replace', 'tab', 'window']);

function isOptionalString(x: unknown): boolean {
  return x === undefined || typeof x === 'string';
}

/** Type guard: true when `x` is one of the {@link Action} variants with well-typed fields. */
export function isAction(x: unknown): x is Action {
  if (!isRecord(x)) return false;
  switch (x.type) {
    case 'open_display':
      return (
        typeof x.file === 'string' &&
        OPEN_DISPLAY_TARGETS.has(x.target) &&
        (x.macros === undefined ||
          (isRecord(x.macros) && Object.values(x.macros).every((v) => typeof v === 'string')))
      );
    case 'write_pv':
      return (
        typeof x.pvName === 'string' && (typeof x.value === 'string' || typeof x.value === 'number')
      );
    case 'execute':
      return typeof x.command === 'string' && isOptionalString(x.description);
    case 'open_webpage':
      return typeof x.url === 'string';
    case 'open_file':
      return typeof x.file === 'string';
    case 'close_display':
      return true;
    default:
      return false;
  }
}

/**
 * Read the reserved `props.actions` list. Returns it only when it is an array whose every
 * entry passes {@link isAction}; otherwise (absent, malformed, or any bad entry) returns `[]`.
 */
export function readActions(props: Readonly<Record<string, unknown>>): Action[] {
  const actions = props.actions;
  if (!Array.isArray(actions) || !actions.every(isAction)) return [];
  return [...actions];
}
