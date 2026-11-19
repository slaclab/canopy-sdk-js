// Types of gen-tokens.mjs, for the tests that import it, written by hand: the generator is plain
// JavaScript so that `node scripts/gen-tokens.mjs` runs it with no build step.

/** A Carbon theme zone. */
export type Zone = 'white' | 'g10' | 'g90' | 'g100';

/** A group of `wiring.json`. */
export type WiringGroup = 'zone' | 'type' | 'layout';

/** A `wiring.json` entry: a contract expression, or why the token keeps Carbon's value. */
export type WiringEntry = string | { carbon: string };

/**
 * `wiring.json`: per group, every enumerated Carbon token and its entry. The group names are
 * `WiringGroup`s once `checkWiring` has passed.
 */
export type Wiring = Record<string, Record<string, WiringEntry>>;

/**
 * How a contract name is defined: an alias of a Carbon zone token (without `--cds-`), or a fixed
 * literal that may have to equal a Carbon layout constant.
 */
export type ContractSpec = { alias: string } | { literal: string; layout?: string };

/** A compiled Carbon stylesheet, parsed. */
export interface ParsedStylesheet {
  /** The declarations of each zone block, name to value. */
  zones: Record<Zone, Map<string, string>>;
  /** The sorted union of the tokens the four zone blocks declare. */
  zoneTokens: string[];
  /** Each context alias and the `-0x` token it derives from. */
  aliases: Record<string, string>;
  /** The type tokens the stylesheet reads through `var()`, sorted. */
  typeTokens: string[];
  /** The two `:root` layout constants. */
  layout: Record<string, string>;
}

/** A name of `tokens.json`. */
export interface TokenName {
  /** The Carbon token (without `--cds-`) the name aliases standalone; null for a fixed literal. */
  alias: string | null;
  literals: Record<Zone, string>;
  /** The Carbon tokens (without `--cds-`) the name drives when hosted, given a wiring map. */
  drives?: string[];
}

/** `tokens.json`. */
export interface Tokens {
  contract: number;
  zones: Zone[];
  names: Record<string, TokenName>;
}

export declare const PATHS: { tokens: string; wiring: string; sheet: string };
export declare const CONTRACT_VERSION: number;
export declare const ZONES: Zone[];
export declare const MIN_ZONE_DECLARATIONS: number;
export declare const SENTINELS: string[];
export declare const VALUE_SENTINEL: { token: string; pattern: RegExp };
export declare const CONTRACT: [name: string, spec: ContractSpec][];
export declare const WIRING_GROUPS: WiringGroup[];
export declare const ALIAS_REASON: string;
export declare const MARKERS: { start: string; end: string };
export declare const HOST_GATE: string;

export declare function parseStylesheet(css: string): ParsedStylesheet;
export declare function mappedTokens(wiring: Wiring): [token: string, expression: string][];
export declare function buildTokens(parsed: ParsedStylesheet, wiring?: Wiring): Tokens;
export declare function enumerateTokens(parsed: ParsedStylesheet): Record<WiringGroup, string[]>;
/** Throws, naming the group and the token, on the first disagreement. */
export declare function checkWiring(wiring: unknown, parsed: ParsedStylesheet): void;
export declare function renderBlocks(tokens: Tokens, wiring: Wiring): string;
export declare function spliceBlocks(sheet: string | null, blocks: string): string;
export declare function serialize(document: unknown): string;
/** The path of the `@carbon/styles` manifest. */
export declare function resolveCarbonStyles(from?: string | URL): string;
export declare function readCarbonStylesheet(): string;
/** The committed wiring map, parsed but not yet checked. */
export declare function readWiring(): Wiring;
