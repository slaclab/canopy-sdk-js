// gen-tokens: derive the host theme contract from the compiled Carbon stylesheet.
//
// The stylesheet that ships in the pinned `@carbon/styles` is the source of truth; the pin must be
// the version `@carbon/react` renders with, and the script fails when the two differ. This
// script parses its four zone blocks (`.cds--white|g10|g90|g100`), enumerates what they declare,
// and writes `tokens.json`: the 27 contract names, the Carbon token each one aliases standalone,
// the literal that token has in each zone (the per-zone fallback of the hosted block) and the
// Carbon tokens the name drives when hosted.
//
// `wiring.json` is the hand-reviewed map from every enumerated Carbon token to the contract
// expression that drives it when hosted, or to the reason it keeps Carbon's value.
//
// From those two it also writes the variable blocks of `host-contract.css`, between the two
// `@generated` marker comments; everything outside the markers is hand-written and left alone.
//
// `--check` writes nothing: it fails, naming the token, when the wiring map and the stylesheet
// disagree, and it fails when `tokens.json` or the generated blocks differ from a fresh render.
//
// Run it through the package script only (`pnpm run gen-tokens`). Inputs and outputs are resolved
// from this file's own location, never from the working directory.

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package directory is `new URL('../', import.meta.url)`. It is spelled through the file path
// because Vite rewrites that literal expression into an asset URL when a test imports this module.
const SCRIPT = fileURLToPath(import.meta.url);
const PACKAGE_DIR = dirname(dirname(SCRIPT));

/** Every file the generator reads or writes, relative to the package this script lives in. */
export const PATHS = {
  tokens: join(PACKAGE_DIR, 'tokens.json'),
  wiring: join(PACKAGE_DIR, 'wiring.json'),
  sheet: join(PACKAGE_DIR, 'host-contract.css'),
};

export const CONTRACT_VERSION = 1;
export const ZONES = ['white', 'g10', 'g90', 'g100'];

/** A zone block with fewer declarations than this is not the theme block we are looking for. */
export const MIN_ZONE_DECLARATIONS = 200;

const DECLARATION = /(--cds-[a-z0-9-]+):\s*([^;]+);/g;
const CONTEXT_ALIAS = /^var\((--cds-[a-z0-9-]+-0[0-3]),\s*((?:[^()]|\([^()]*\))+)\)$/;
const TYPE_READ = /var\(\s*(--cds-[a-z0-9-]+-font-(?:size|family))\b/g;
const LAYOUT_CONSTANTS = ['--cds-layout-size-height-xs', '--cds-layout-size-height-sm'];

/** Tokens whose absence means Carbon renamed a family the wiring depends on. */
export const SENTINELS = [
  '--cds-button-primary-hover',
  '--cds-toggle-off',
  '--cds-content-switcher-selected',
  '--cds-button-danger-primary',
  '--cds-button-separator',
];

/**
 * `--cds-border-subtle` must keep deriving from `-00`: the contract's `border` aliases
 * `border-subtle-00`, so a Carbon that moves the alias to `-01` would silently change which
 * contract name paints layer-one borders.
 */
export const VALUE_SENTINEL = {
  token: '--cds-border-subtle',
  pattern: /^var\(--cds-border-subtle-00,/,
};

/**
 * The contract, in its published order. A colour name aliases one Carbon zone token and falls
 * back to that token's literal in each zone. A non-colour name has a fixed literal equal to
 * Carbon's own `:root` constant, so a standalone page keeps its pixels.
 */
export const CONTRACT = [
  ['font-ui', { literal: "'IBM Plex Sans', system-ui, sans-serif" }],
  ['font-mono', { literal: "'IBM Plex Mono', monospace" }],
  ['text-sm', { literal: '0.75rem' }],
  ['text-md', { literal: '0.875rem' }],
  ['text-lg', { literal: '1rem' }],
  ['radius-sm', { literal: '0' }],
  ['radius-md', { literal: '0' }],
  ['control-h-xs', { literal: '1.5rem', layout: '--cds-layout-size-height-xs' }],
  ['control-h-sm', { literal: '2rem', layout: '--cds-layout-size-height-sm' }],
  ['bg-base', { alias: 'background' }],
  ['bg-panel', { alias: 'layer-01' }],
  ['bg-elevated', { alias: 'layer-02' }],
  ['bg-field', { alias: 'field-01' }],
  ['text-primary', { alias: 'text-primary' }],
  ['text-secondary', { alias: 'text-secondary' }],
  ['text-muted', { alias: 'text-helper' }],
  ['border', { alias: 'border-subtle-00' }],
  ['border-strong', { alias: 'border-strong-01' }],
  ['accent', { alias: 'interactive' }],
  ['on-accent', { alias: 'text-on-color' }],
  ['accent-hover', { alias: 'button-primary-hover' }],
  ['accent-tint', { alias: 'layer-selected-01' }],
  ['hover-tint', { alias: 'layer-hover-01' }],
  ['focus', { alias: 'focus' }],
  ['status-success', { alias: 'support-success' }],
  ['status-warning', { alias: 'support-warning' }],
  ['status-error', { alias: 'support-error' }],
];

/** The groups of `wiring.json`, one per family of enumerated token. */
export const WIRING_GROUPS = ['zone', 'type', 'layout'];

/** Why a context alias is never wired: it follows the `-0x` token it derives from. */
export const ALIAS_REASON = 'context alias derives from the -0x token';

const CONTRACT_REFERENCE = /--canopy-([a-z0-9-]+)/g;

/** The comments that fence the generated blocks of `host-contract.css`. */
export const MARKERS = {
  start: '/* @generated blocks start */',
  end: '/* @generated blocks end */',
};

/** The selector of the hosted rule of one zone: it outranks the zone class it repeats. */
export const HOST_GATE = 'html[data-canopy-host]';

function fail(message) {
  throw new Error(`gen-tokens: ${message}`);
}

/** The declarations of the one `.cds--<zone> { … }` theme block, as a name → value map. */
function parseZoneBlock(css, zone) {
  const block = new RegExp(`(?:^|\\})\\s*\\.cds--${zone}\\s*\\{([^{}]*)\\}`, 'gm');
  const found = [];
  for (const match of css.matchAll(block)) {
    const declarations = new Map();
    for (const [, name, value] of match[1].matchAll(DECLARATION)) {
      declarations.set(name, value.trim());
    }
    if (declarations.size >= MIN_ZONE_DECLARATIONS) found.push(declarations);
  }
  if (found.length !== 1) {
    fail(
      `expected one .cds--${zone} block with at least ${MIN_ZONE_DECLARATIONS} declarations, found ${found.length}`
    );
  }
  return found[0];
}

/** The two layout constants, which Carbon declares on `:root`. */
function parseLayoutConstants(css) {
  const layout = {};
  for (const [, body] of css.matchAll(/(?:^|\})\s*:root\s*\{([^{}]*)\}/gm)) {
    for (const [, name, value] of body.matchAll(DECLARATION)) {
      if (LAYOUT_CONSTANTS.includes(name)) layout[name] = value.trim();
    }
  }
  for (const name of LAYOUT_CONSTANTS) {
    if (!(name in layout)) fail(`layout constant ${name} is not declared on :root`);
  }
  return layout;
}

/**
 * Parse a compiled Carbon stylesheet.
 *
 * Returns the per-zone declarations (`zones`), the enumerated zone token set as the sorted union
 * over the four blocks (`zoneTokens`; a token may be absent from some zones), the context aliases
 * (`aliases`: token → the `-0x` token it derives from), the type tokens the stylesheet reads
 * through `var()` (`typeTokens`) and the two `:root` layout constants (`layout`).
 */
export function parseStylesheet(css) {
  const zones = {};
  const union = new Set();
  const aliases = {};
  for (const zone of ZONES) {
    const declarations = parseZoneBlock(css, zone);
    zones[zone] = declarations;
    for (const [name, value] of declarations) {
      union.add(name);
      if (!value.includes('var(')) continue;
      const alias = CONTEXT_ALIAS.exec(value);
      if (!alias || alias[2].includes('var(')) {
        fail(`${name} in .cds--${zone} has an unsupported var() value: ${value}`);
      }
      if (aliases[name] !== undefined && aliases[name] !== alias[1]) {
        fail(`${name} derives from ${aliases[name]} in one zone and ${alias[1]} in .cds--${zone}`);
      }
      aliases[name] = alias[1];
    }
  }

  for (const zone of ZONES) {
    for (const sentinel of SENTINELS) {
      if (!zones[zone].has(sentinel)) fail(`sentinel ${sentinel} is missing from .cds--${zone}`);
    }
    const value = zones[zone].get(VALUE_SENTINEL.token);
    if (value === undefined || !VALUE_SENTINEL.pattern.test(value)) {
      fail(
        `${VALUE_SENTINEL.token} in .cds--${zone} no longer derives from --cds-border-subtle-00: ${value}`
      );
    }
  }

  const typeTokens = [...new Set([...css.matchAll(TYPE_READ)].map((match) => match[1]))].sort();
  if (typeTokens.length === 0) fail('the stylesheet reads no type token through var()');

  return {
    zones,
    zoneTokens: [...union].sort(),
    aliases,
    typeTokens,
    layout: parseLayoutConstants(css),
  };
}

/**
 * The wired tokens of a checked `wiring.json`, as `[token, expression]` pairs: the entries that
 * are a contract expression, group by group and sorted by token inside each group.
 */
export function mappedTokens(wiring) {
  const mapped = [];
  for (const group of WIRING_GROUPS) {
    for (const token of Object.keys(wiring[group]).sort()) {
      const entry = wiring[group][token];
      if (typeof entry === 'string') mapped.push([token, entry]);
    }
  }
  return mapped;
}

/** Per contract name, the sorted Carbon tokens (without `--cds-`) whose expression reads it. */
function drivenTokens(wiring) {
  const drives = Object.fromEntries(CONTRACT.map(([name]) => [name, new Set()]));
  for (const [token, expression] of mappedTokens(wiring)) {
    for (const [, name] of expression.matchAll(CONTRACT_REFERENCE)) {
      drives[name].add(token.slice('--cds-'.length));
    }
  }
  return Object.fromEntries(CONTRACT.map(([name]) => [name, [...drives[name]].sort()]));
}

/**
 * The `tokens.json` document for a parsed stylesheet. Given the checked `wiring.json` as well,
 * every name also lists the Carbon tokens it `drives`; that is the document the script writes.
 */
export function buildTokens(parsed, wiring) {
  const tokens = buildNames(parsed);
  if (wiring === undefined) return tokens;
  const drives = drivenTokens(wiring);
  for (const [name] of CONTRACT) tokens.names[name].drives = drives[name];
  return tokens;
}

function buildNames(parsed) {
  const names = {};
  for (const [name, spec] of CONTRACT) {
    const literals = {};
    if (spec.alias === undefined) {
      if (spec.layout !== undefined && parsed.layout[spec.layout] !== spec.literal) {
        fail(
          `${name} is fixed at ${spec.literal} but ${spec.layout} is ${parsed.layout[spec.layout]}`
        );
      }
      for (const zone of ZONES) literals[zone] = spec.literal;
      names[name] = { alias: null, literals };
      continue;
    }
    const source = `--cds-${spec.alias}`;
    for (const zone of ZONES) {
      const value = parsed.zones[zone].get(source);
      if (value === undefined) {
        fail(`${name} aliases ${source}, which .cds--${zone} does not declare`);
      }
      if (value.includes('var(')) {
        fail(`${name} aliases ${source}, which is itself an alias in .cds--${zone}: ${value}`);
      }
      literals[zone] = value;
    }
    names[name] = { alias: spec.alias, literals };
  }
  return { contract: CONTRACT_VERSION, zones: ZONES, names };
}

/** The tokens `wiring.json` must map, group by group: exactly these and no others. */
export function enumerateTokens(parsed) {
  return {
    zone: parsed.zoneTokens,
    type: parsed.typeTokens,
    layout: Object.keys(parsed.layout).sort(),
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One wiring entry is a contract expression or `{ "carbon": "<reason>" }`. */
function checkWiringEntry(group, token, entry, aliases) {
  const where = `wiring.json group "${group}" maps ${token}`;
  if (isRecord(entry)) {
    const keys = Object.keys(entry);
    if (keys.length !== 1 || keys[0] !== 'carbon') {
      fail(`${where} to an object that is not { "carbon": "<reason>" }`);
    }
    if (typeof entry.carbon !== 'string' || entry.carbon.trim() === '') {
      fail(`${where} to Carbon without a reason`);
    }
    return;
  }
  if (typeof entry !== 'string' || entry.trim() === '') {
    fail(`${where} to neither a contract expression nor { "carbon": "<reason>" }`);
  }
  if (token in aliases) {
    fail(`${where} to an expression, but it is a context alias of ${aliases[token]}`);
  }
  // A hosted `--cds-*` that reads another `--cds-*` can close a cycle with the contract aliases.
  if (entry.includes('--cds-')) fail(`${where} to an expression that reads a Carbon token`);
  const names = new Set(CONTRACT.map(([name]) => name));
  const references = [...entry.matchAll(CONTRACT_REFERENCE)].map((match) => match[1]);
  if (references.length === 0) fail(`${where} to an expression that reads no contract name`);
  for (const name of references) {
    if (!names.has(name)) fail(`${where} to --canopy-${name}, which is not a contract name`);
  }
}

/**
 * Check a `wiring.json` document against a parsed stylesheet, in both directions and group by
 * group: every enumerated token is mapped, and no mapped key is outside the enumeration. The
 * first disagreement throws, naming the group and the token.
 */
export function checkWiring(wiring, parsed) {
  if (!isRecord(wiring)) fail('wiring.json is not an object of groups');
  for (const group of Object.keys(wiring)) {
    if (!WIRING_GROUPS.includes(group)) fail(`wiring.json has an unknown group "${group}"`);
  }
  const enumerated = enumerateTokens(parsed);
  for (const group of WIRING_GROUPS) {
    const map = wiring[group];
    if (!isRecord(map)) fail(`wiring.json has no group "${group}"`);
    for (const token of enumerated[group]) {
      if (!Object.hasOwn(map, token)) {
        fail(`wiring.json group "${group}" does not map ${token}`);
      }
    }
    const known = new Set(enumerated[group]);
    for (const token of Object.keys(map)) {
      if (!known.has(token)) {
        fail(`wiring.json group "${group}" maps ${token}, which the stylesheet does not enumerate`);
      }
      checkWiringEntry(group, token, map[token], parsed.aliases);
    }
  }
}

function rule(selectors, declarations) {
  const lines = declarations.map(([name, value]) => `  ${name}: ${value};`);
  return `${selectors.join(',\n')} {\n${lines.join('\n')}\n}`;
}

/**
 * The generated blocks of `host-contract.css`, from the start marker to the end marker.
 *
 * Block 1 is ungated: on the four zone classes, every contract name as an alias of the Carbon
 * token it stands for, or its fixed literal. Block 2 is one rule per zone behind the host gate:
 * every contract name reads the host's value and falls back to that zone's Carbon literal, and
 * every wired Carbon token is rewired onto the contract. Inside the gate no `--canopy-*` reads a
 * `--cds-*`: such a pair would be a cycle, which invalidates both.
 */
export function renderBlocks(tokens, wiring) {
  const names = Object.entries(tokens.names);
  const standalone = rule(
    tokens.zones.map((zone) => `.cds--${zone}`),
    names.map(([name, { alias, literals }]) => [
      `--canopy-${name}`,
      alias === null ? literals[tokens.zones[0]] : `var(--cds-${alias})`,
    ])
  );
  const wired = mappedTokens(wiring);
  const hosted = tokens.zones.map((zone) =>
    rule(
      [`${HOST_GATE} .cds--${zone}`],
      [
        ...names.map(([name, { literals }]) => [
          `--canopy-${name}`,
          `var(--canopy-host-${name}, ${literals[zone]})`,
        ]),
        ...wired,
      ]
    )
  );
  return [
    MARKERS.start,
    '/* Written by scripts/gen-tokens.mjs from @carbon/styles and wiring.json: do not edit between',
    '   the markers, run `pnpm run gen-tokens`. Host theme contract ' +
      `${tokens.contract}: a ${tokens.contract}.x release adds`,
    '   names with fallbacks only; renaming or removing a name is the next major. */',
    '',
    standalone,
    '',
    hosted.join('\n\n'),
    MARKERS.end,
  ].join('\n');
}

/** Where the generated blocks sit in a sheet: both markers, once each, in order. */
function locateBlocks(sheet) {
  const start = sheet.indexOf(MARKERS.start);
  const end = sheet.indexOf(MARKERS.end);
  if (
    start === -1 ||
    end < start ||
    sheet.indexOf(MARKERS.start, start + 1) !== -1 ||
    sheet.indexOf(MARKERS.end, end + 1) !== -1
  ) {
    fail(`${PATHS.sheet} does not hold one "${MARKERS.start}" … "${MARKERS.end}" pair`);
  }
  return { start, end: end + MARKERS.end.length };
}

/**
 * A sheet with its generated blocks replaced. Text outside the markers is kept byte for byte; a
 * sheet that does not exist yet (`null`) starts as the blocks alone.
 */
export function spliceBlocks(sheet, blocks) {
  if (sheet === null) return `${blocks}\n`;
  const { start, end } = locateBlocks(sheet);
  return sheet.slice(0, start) + blocks + sheet.slice(end);
}

/** The first line at which a committed artefact and its fresh render part ways. */
function staleAt(committed, fresh) {
  const have = committed.split('\n');
  const want = fresh.split('\n');
  const at = want.findIndex((line, i) => line !== have[i]);
  const i = at === -1 ? want.length : at;
  return `expected ${JSON.stringify((want[i] ?? '').trim())}, found ${JSON.stringify((have[i] ?? '').trim())}`;
}

/**
 * Fail when a committed artefact is not what the generator would write now. A package that has
 * generated neither artefact yet has nothing to be stale; one without the other is incomplete.
 */
function checkFresh(tokens, blocks) {
  const committed = {
    tokens: existsSync(PATHS.tokens) ? readFileSync(PATHS.tokens, 'utf8') : null,
    sheet: existsSync(PATHS.sheet) ? readFileSync(PATHS.sheet, 'utf8') : null,
  };
  if (committed.tokens === null && committed.sheet === null) return false;
  for (const artefact of ['tokens', 'sheet']) {
    if (committed[artefact] === null) fail(`${PATHS[artefact]} is missing; run gen-tokens`);
  }
  const fresh = serialize(tokens);
  if (committed.tokens !== fresh) {
    fail(`${PATHS.tokens} is stale (${staleAt(committed.tokens, fresh)}); run gen-tokens`);
  }
  const { start, end } = locateBlocks(committed.sheet);
  const generated = committed.sheet.slice(start, end);
  if (generated !== blocks) {
    fail(
      `the generated blocks of ${PATHS.sheet} are stale (${staleAt(generated, blocks)}); run gen-tokens`
    );
  }
  return true;
}

/** The exact bytes of a generated JSON file. */
export function serialize(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** The `version` field of a package manifest. */
function manifestVersion(path) {
  return JSON.parse(readFileSync(path, 'utf8')).version;
}

/**
 * The manifest of the `@carbon/styles` this package resolves, once it is shown to be the same
 * version as the `@carbon/styles` that `@carbon/react` resolves from its own location. The
 * contract is derived from the first and components render with the second; when they differ the
 * generated fallbacks would describe a stylesheet nobody renders, so this fails instead.
 */
export function resolveCarbonStyles(from = import.meta.url) {
  const resolve = createRequire(from).resolve;
  const manifest = resolve('@carbon/styles/package.json');
  const rendered = createRequire(resolve('@carbon/react/package.json')).resolve(
    '@carbon/styles/package.json'
  );
  const read = manifestVersion(manifest);
  const used = manifestVersion(rendered);
  if (read !== used) {
    fail(
      `@carbon/styles ${read} is not the @carbon/styles ${used} that @carbon/react renders ` +
        `with; pin the @carbon/styles devDependency to ${used}`
    );
  }
  return manifest;
}

/** The compiled stylesheet of the `@carbon/styles` this package resolves. */
export function readCarbonStylesheet() {
  const manifest = resolveCarbonStyles();
  return readFileSync(join(dirname(manifest), 'css', 'styles.css'), 'utf8');
}

/** The committed wiring map of this package. */
export function readWiring() {
  let text;
  try {
    text = readFileSync(PATHS.wiring, 'utf8');
  } catch {
    fail(`cannot read ${PATHS.wiring}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${PATHS.wiring} is not JSON: ${error instanceof Error ? error.message : error}`);
  }
}

function main(args) {
  const unknown = args.find((arg) => arg !== '--check');
  if (unknown !== undefined) fail(`unknown argument ${unknown}`);
  const parsed = parseStylesheet(readCarbonStylesheet());
  buildTokens(parsed);
  const wiring = readWiring();
  checkWiring(wiring, parsed);
  const tokens = buildTokens(parsed, wiring);
  const blocks = renderBlocks(tokens, wiring);
  if (args.includes('--check')) {
    console.log(`gen-tokens: ${PATHS.wiring} maps every enumerated token`);
    if (checkFresh(tokens, blocks)) {
      console.log(`gen-tokens: ${PATHS.tokens} and ${PATHS.sheet} are fresh`);
    }
    return;
  }
  const sheet = spliceBlocks(
    existsSync(PATHS.sheet) ? readFileSync(PATHS.sheet, 'utf8') : null,
    blocks
  );
  writeFileSync(PATHS.tokens, serialize(tokens));
  writeFileSync(PATHS.sheet, sheet);
  console.log(`gen-tokens: wrote ${PATHS.tokens} and ${PATHS.sheet}`);
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry === SCRIPT) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
