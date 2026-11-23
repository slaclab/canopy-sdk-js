import type { PVService, PVData, PVListener } from './PVService.js';
import { AlarmSeverity } from '../alarm.js';

// ── loc:// URL grammar ──────────────────────────────────────────────────────
//
// Two spellings declare a local, and a bare `loc://<name>` refers to one:
//
// - `loc://<name>?type=<int|float|str|array>&init=<value>` — what the converter
//   writes for EDM `LOC\name=<t>:<value>` locals and for the Phoebus forms it
//   can map.
// - `loc://<name><VType>(init)` — the Phoebus form, as stored screens and
//   hand-written ones carry it. `<VType>` and `(init)` are each optional. The
//   grammar is the converter's (`pydmconverter/bob/local_pv.py`), with one
//   difference: the converter parses after macro normalisation, while a URL
//   reaching this service may still hold an unresolved `$(NAME)` macro.
//
// `<VType>` and `(init)` are recognised only when the group closes at the end
// of the URL or right before `?`; otherwise the whole text before `?` is the
// name. A `(` that follows `$` opens a macro, never an initialiser. Names are
// opaque strings — EDM scope prefixes (e.g. `${!W}` for window scope) ride
// along verbatim, which preserves EDM's sharing semantics within one rendered
// page. Every spelling of one name is the same local.

interface ParsedLocUrl {
  name: string;
  /** `type` of the query form. */
  type?: string;
  /** The text between `<` and `>` of the Phoebus form. */
  vtype?: string;
  /** Initialiser text: the query's `init` value, or the text inside `(…)` verbatim. */
  init?: string;
}

/** `name[<VType>][(init)]`, or null when `text` does not end in such a group. */
function parseDeclaration(text: string): ParsedLocUrl | null {
  let at = 0;
  while (at < text.length) {
    const ch = text[at];
    if (ch === '<' || (ch === '(' && text[at - 1] !== '$')) break;
    at += 1;
  }
  if (at === text.length) return null;
  const out: ParsedLocUrl = { name: text.slice(0, at) };
  let rest = text.slice(at);
  if (rest[0] === '<') {
    const close = rest.indexOf('>');
    if (close === -1) return null;
    out.vtype = rest.slice(1, close).trim();
    rest = rest.slice(close + 1);
    if (rest === '') return out;
  }
  if (rest[0] !== '(' || !rest.endsWith(')')) return null;
  out.init = rest.slice(1, -1);
  return out;
}

export function parseLocUrl(address: string): ParsedLocUrl | null {
  if (!address.startsWith('loc://')) return null;
  const rest = address.slice('loc://'.length);
  // An initialiser may itself hold a `?`, so the whole text is tried first.
  const whole = parseDeclaration(rest);
  if (whole && !whole.name.includes('?')) return whole;
  const queryAt = rest.indexOf('?');
  if (queryAt === -1) return { name: rest };
  const head = rest.slice(0, queryAt);
  const out: ParsedLocUrl = parseDeclaration(head) ?? { name: head };
  for (const pair of rest.slice(queryAt + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === 'type') out.type = value;
    else if (key === 'init' && out.init === undefined) out.init = value;
  }
  return out;
}

// ── Declared types ──────────────────────────────────────────────────────────

/** What a declaration says its local holds; `unsupported` is a VType with no local form. */
type LocalType = 'number' | 'string' | 'number[]' | 'string[]' | 'unsupported';
type LocalValue = number | string | number[] | string[];

const VTYPES: Record<string, LocalType> = {
  VDouble: 'number',
  VLong: 'number',
  VInt: 'number',
  VEnum: 'number',
  VString: 'string',
  VDoubleArray: 'number[]',
  VStringArray: 'string[]',
};

const QUERY_TYPES: Record<string, LocalType> = { int: 'number', float: 'number', str: 'string' };

/** The type a URL names, or undefined when it names none (the value then decides). */
function declaredType(parsed: ParsedLocUrl): LocalType | undefined {
  if (parsed.vtype !== undefined) {
    return Object.hasOwn(VTYPES, parsed.vtype) ? VTYPES[parsed.vtype] : 'unsupported';
  }
  if (parsed.type !== undefined && Object.hasOwn(QUERY_TYPES, parsed.type)) {
    return QUERY_TYPES[parsed.type];
  }
  return undefined;
}

/** Split on commas outside single or double quotes. */
function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Strip one pair of matching quotes around the trimmed text. */
function unquote(literal: string): { text: string; quoted: boolean } {
  const text = literal.trim();
  const first = text[0];
  if (text.length >= 2 && first === text[text.length - 1] && (first === '"' || first === "'")) {
    return { text: text.slice(1, -1), quoted: true };
  }
  return { text, quoted: false };
}

function coerceQueryInit(type: string | undefined, raw: string): number | string {
  if (type === 'str') return raw;
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

/** The value a `(…)` initialiser stands for under `type`. */
function coerceLiteral(type: LocalType | undefined, raw: string): LocalValue {
  if (type === 'number[]' || type === 'string[]') {
    const items =
      raw.trim() === '' ? [] : splitTopLevelCommas(raw).map((item) => unquote(item).text);
    return type === 'string[]' ? items : items.map(Number);
  }
  // A VEnum initialiser may list its labels after the index; the index is the value.
  const { text, quoted } = unquote(type === 'number' ? splitTopLevelCommas(raw)[0]! : raw);
  if (type === 'string' || quoted || text === '') return text;
  const num = Number(text);
  return Number.isFinite(num) ? num : text;
}

function initialValue(parsed: ParsedLocUrl, type: LocalType | undefined): LocalValue | undefined {
  if (parsed.init === undefined) return undefined;
  // Only the Phoebus form quotes and lists; a query value is taken as written.
  if (parsed.vtype === undefined && parsed.type !== undefined) {
    return coerceQueryInit(parsed.type, parsed.init);
  }
  return coerceLiteral(type, parsed.init);
}

function kindOf(value: LocalValue): PVData['valueKind'] {
  if (Array.isArray(value)) return 'waveform';
  return typeof value === 'number' ? 'scalar' : 'string';
}

interface LocalPV {
  data: PVData;
  initialized: boolean;
  /** The first type a declaration named for this local; later ones must agree. */
  type?: LocalType;
  listeners: Set<PVListener>;
}

/**
 * Client-side local PVs (the EDM `LOC\` paradigm): screen-scoped scratch
 * variables that widgets write and rules read, never touching a gateway.
 *
 * - A declaring URL (`?type=…&init=…` or `<VType>(init)`) initializes the PV
 *   on first sight; later declarations are ignored (first-wins, PyDM
 *   semantics). Short-form references before any declaration read as
 *   disconnected until one arrives or something puts a value.
 * - A declaration that cannot be honoured — a VType with no local form, or a
 *   type other than the one first declared for the name — is ignored with one
 *   `console.warn` per name. Nothing throws: `PVService` has no error channel.
 * - Scope is the service instance. The composition root owns one per page
 *   and calls `clear()` when the screen changes, mirroring EDM's
 *   window-local lifetime.
 */
export class LocalPVService implements PVService {
  private pvs = new Map<string, LocalPV>();
  private warned = new Set<string>();
  private _connected = false;

  get isConnected() {
    return this._connected;
  }

  connect() {
    this._connected = true;
  }

  disconnect() {
    this._connected = false;
  }

  /** Drop every local (screen change); active listeners see disconnected. */
  clear() {
    for (const pv of this.pvs.values()) {
      pv.data = { ...pv.data, connected: false };
      pv.initialized = false;
      pv.type = undefined;
      for (const listener of pv.listeners) listener(pv.data);
    }
    // Keep entries with live listeners so re-declarations reattach; drop idle ones.
    for (const [name, pv] of this.pvs) {
      if (pv.listeners.size === 0) this.pvs.delete(name);
    }
    this.warned.clear();
  }

  private warnOnce(name: string, message: string) {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    console.warn(`loc://${name}: ${message}`);
  }

  private entry(address: string): LocalPV {
    const parsed = parseLocUrl(address) ?? { name: address };
    let pv = this.pvs.get(parsed.name);
    if (!pv) {
      pv = {
        initialized: false,
        listeners: new Set(),
        data: {
          value: 0,
          displayValue: '---',
          severity: AlarmSeverity.NO_ALARM,
          connected: false,
          timestamp: Date.now(),
          units: '',
          precision: 0,
          lowerLimit: 0,
          upperLimit: 0,
        },
      };
      this.pvs.set(parsed.name, pv);
    }
    const type = declaredType(parsed);
    if (type === 'unsupported') {
      this.warnOnce(
        parsed.name,
        `local PV type ${parsed.vtype} is not supported; declaration ignored`
      );
      return pv;
    }
    if (type !== undefined) {
      if (pv.type !== undefined && pv.type !== type) {
        this.warnOnce(
          parsed.name,
          `declared again as ${type}, already declared as ${pv.type}; the first declaration wins`
        );
        return pv;
      }
      pv.type = type;
    }
    const value = pv.initialized ? undefined : initialValue(parsed, type);
    if (value !== undefined) {
      pv.initialized = true;
      pv.data = {
        ...pv.data,
        value,
        displayValue: String(value),
        valueKind: kindOf(value),
        connected: true,
        timestamp: Date.now(),
      };
      for (const listener of pv.listeners) listener(pv.data);
    }
    return pv;
  }

  subscribe(pvName: string, listener: PVListener): () => void {
    const pv = this.entry(pvName);
    pv.listeners.add(listener);
    listener(pv.data);
    return () => {
      pv.listeners.delete(listener);
    };
  }

  put(pvName: string, value: number | string | boolean) {
    const pv = this.entry(pvName);
    const stored = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    pv.initialized = true;
    pv.data = {
      ...pv.data,
      value: stored,
      displayValue: String(stored),
      valueKind: typeof stored === 'number' ? 'scalar' : 'string',
      connected: true,
      timestamp: Date.now(),
    };
    for (const listener of pv.listeners) listener(pv.data);
  }

  getSnapshot(pvName: string): PVData | undefined {
    const parsed = parseLocUrl(pvName) ?? { name: pvName };
    return this.pvs.get(parsed.name)?.data;
  }
}
