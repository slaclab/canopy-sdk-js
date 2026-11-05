// Types of runner.mjs and of the data it reads (hostProbes.json, host.json), written by hand:
// the module is plain JavaScript so that Node, Playwright and a script outside any TypeScript
// project can load it as it is.

import type { PageLike, SetupName } from './setups.mjs';

export type ProbeApp = 'viewer' | 'trace' | 'correlation' | 'waveform';

/** The Carbon zones a probed element can live in. */
export type Zone = 'white' | 'g10' | 'g90' | 'g100';

/** The CSS properties a row may probe: longhands only. */
export type ProbeProperty =
  | 'background-color'
  | 'border-bottom-color'
  | 'border-bottom-width'
  | 'border-left-color'
  | 'border-left-width'
  | 'border-top-color'
  | 'border-top-left-radius'
  | 'color'
  | 'fill'
  | 'font-family'
  | 'font-size'
  | 'height'
  | 'min-height'
  | 'padding-top'
  | 'width'
  | 'outline-color'
  | 'outline-width';

/** The property follows a contract name. */
export interface ContractTarget {
  /** A name of tokens.json. */
  contract: string;
  /** The rule exists only in a hosted document; standalone the property is not checked. */
  hostOnly?: true;
  /** Standalone, Carbon paints this token of its own (a wiring.json zone key without `--cds-`). */
  standalone?: { carbon: string };
}

/** The property stays on a Carbon token (a wiring.json zone key without `--cds-`). */
export interface CarbonTarget {
  carbon: string;
}

/** The property has a fixed value. */
export interface LiteralTarget {
  literal: string;
  /** The rule exists only in a hosted document; standalone the property is not checked. */
  hostOnly?: true;
}

/** The property is a `color-mix()` over contract variables, written out exactly. */
export interface MixTarget {
  mix: string;
  /** Standalone, Carbon paints this token of its own (a wiring.json zone key without `--cds-`). */
  standalone?: { carbon: string };
}

/**
 * Geometry, under `width` only: both inline edges of the element lie within the box of its
 * nearest ancestor matching `inside`, and its box is not empty.
 */
export interface InsideTarget {
  /** A selector of an ancestor of the element. */
  inside: string;
}

export type Target = ContractTarget | CarbonTarget | LiteralTarget | MixTarget | InsideTarget;

export interface ProbeRow {
  app: ProbeApp;
  /** The page path to open instead of the app's default; `{theme}` is the theme id. */
  page?: string;
  selector: string;
  pseudo?: '::after' | '::before';
  /** Run in order before the row is checked. */
  setup: SetupName[];
  viewport?: { width: number; height: number };
  /** `false`: the row cannot run against a deployed stack. */
  stack?: false;
  /** The page needs a hare backend (implied by the `open-write-dialog` setup). */
  hare?: true;
  /** `InsideTarget` is allowed under `width` only. */
  expect: Partial<Record<ProbeProperty, Target>>;
}

/** hostProbes.json. */
export interface HostProbes {
  /** What the file is and whose DOM its app rows describe. */
  $comment?: string;
  defaults: { page: Record<ProbeApp, string> };
  rows: ProbeRow[];
}

/** host.json: the values host.css declares, per theme id. */
export interface HostFixture {
  contract: number;
  themes: Record<string, { mode: 'light' | 'dark'; values: Record<string, string> }>;
}

/** tokens.json, as far as the runner reads it. */
export interface ContractTokens {
  zones: string[];
  names: Record<string, { literals: Record<string, string> }>;
}

/** One side of a property that was compared. */
export interface ProbeComparison {
  /** What the value was compared against, in words. */
  against: string;
  /** Set when the compared value is a variable of the zone, not the property itself. */
  subject?: string;
  actual?: string | number;
  expected: string | number | null;
  expectedRaw?: string;
  pass: boolean;
}

export interface ProbeCheck {
  property: string;
  /** The property's computed value, normalised. */
  actual: string | number;
  /** The property's computed value as read. */
  raw: string;
  comparisons: ProbeComparison[];
  /** Why the property was not checked. */
  skipped?: 'hostOnly';
}

export interface ProbeResult {
  ok: boolean;
  /** One line per comparison that did not hold. */
  failures: string[];
  /** The properties not checked (hostOnly targets, standalone). */
  skipped: string[];
  /** Whether the document carries `data-canopy-host`; `null` when no element matched. */
  gated: boolean | null;
  zone: Zone | null;
  checks: ProbeCheck[];
}

export interface CheckRowOptions {
  /** Whether the document is expected to be hosted. Default `false`. */
  hosted?: boolean;
  /** The value of each contract name the host stylesheet declares. Default: none. */
  hostValues?: Record<string, string>;
  /** The contract data. Default: this package's tokens.json. */
  tokens?: ContractTokens;
  /** `false`: return a failing result instead of throwing `ProbeFailure`. Default `true`. */
  throwOnFailure?: boolean;
}

/**
 * The Carbon zone element a probed element lives in: every variable a row compares against is
 * resolved on it. Self-contained, so it can be passed to `page.evaluate`.
 */
export declare function zoneOf(el: Element): Element | null;

/** The first family of a `font-family` value, without quotes or whitespace, lower-cased. */
export declare function normalizeFont(value: string): string;

/** A colour as the browser computes it, resolved inside `zone`; `''` when unparsable. */
export declare function normalizeColor(zone: Element, value: string): string;

/** A length in whole CSS pixels, resolved inside `zone`; `NaN` when unparsable. */
export declare function normalizeLength(zone: Element, value: string): number;

/** A row that did not hold. */
export declare class ProbeFailure extends Error {
  constructor(message: string, result: ProbeResult);
  result: ProbeResult;
}

/** The page path a row runs on, for one theme id. */
export declare function pageFor(
  probes: HostProbes,
  row: Pick<ProbeRow, 'app' | 'page'>,
  theme: string
): string;

/** Runs a row's setups in order. */
export declare function runSetups(
  page: PageLike,
  row: Pick<ProbeRow, 'selector' | 'setup'>,
  ctx?: { theme?: string; goto?: (path: string) => Promise<unknown> }
): Promise<void>;

/**
 * The value of every contract name a host stylesheet declares on the anchor
 * (`[data-canopy-host-root]`), as `--canopy-host-<name>` resolves there.
 */
export declare function readHostValues(
  page: PageLike,
  names: string[]
): Promise<Record<string, string>>;

/**
 * Checks one row against the page as it stands (run its setups first). Throws `ProbeFailure`
 * when the row does not hold, unless `throwOnFailure` is `false`.
 */
export declare function checkRow(
  page: PageLike,
  row: ProbeRow,
  options?: CheckRowOptions
): Promise<ProbeResult>;
