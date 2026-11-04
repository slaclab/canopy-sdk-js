// The generated blocks of `host-contract.css`, read as text: structure only. What the variables
// compute to in a browser is asserted by the Playwright suites of the apps that load the sheet.

import { describe, expect, it } from 'vitest';

// The package has no @types/node, so the Node built-ins this test needs are reached through
// process.getBuiltinModule with just the shape used here.
interface NodeBuiltins {
  fs: { readFileSync(path: string, encoding: 'utf8'): string };
  path: { join(...parts: string[]): string; dirname(path: string): string };
}

const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } })
  .process;
const fs = proc.getBuiltinModule('node:fs') as NodeBuiltins['fs'];
const path = proc.getBuiltinModule('node:path') as NodeBuiltins['path'];

const PACKAGE_DIR = path.dirname(path.dirname(expect.getState().testPath ?? ''));
const read = (name: string) => fs.readFileSync(path.join(PACKAGE_DIR, name), 'utf8');

interface Tokens {
  contract: number;
  zones: string[];
  names: Record<
    string,
    { alias: string | null; literals: Record<string, string>; drives: string[] }
  >;
}
type Wiring = Record<string, Record<string, string | { carbon: string }>>;
type Declarations = [name: string, value: string][];

const START = '/* @generated blocks start */';
const END = '/* @generated blocks end */';
const GATE = 'html[data-canopy-host]';

const TOKENS = JSON.parse(read('tokens.json')) as Tokens;
const WIRING = JSON.parse(read('wiring.json')) as Wiring;
const SHEET = read('host-contract.css');

/** The rules between the two markers, as selector → declarations in source order. */
function generatedRules(sheet: string): Map<string, Declarations> {
  const start = sheet.indexOf(START);
  const end = sheet.indexOf(END);
  if (start === -1 || end < start) throw new Error('host-contract.css has no generated blocks');
  const text = sheet.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map<string, Declarations>();
  for (const [, selector, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = selector.trim().replace(/\s*,\s*/g, ', ');
    if (rules.has(key)) throw new Error(`the generated blocks declare ${key} twice`);
    rules.set(
      key,
      [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [
        name,
        value.trim(),
      ])
    );
  }
  return rules;
}

const RULES = generatedRules(SHEET);
const STANDALONE = TOKENS.zones.map((zone) => `.cds--${zone}`).join(', ');
const gated = (zone: string) => `${GATE} .cds--${zone}`;

const NAMES = Object.keys(TOKENS.names);
const CONTRACT_NAMES = NAMES.map((name) => `--canopy-${name}`);
/** The names whose standalone literal differs by zone; each zone class declares them alone. */
const PER_ZONE = NAMES.filter((name) => {
  const { alias, literals } = TOKENS.names[name];
  return alias === null && new Set(Object.values(literals)).size > 1;
});
const UNIFORM = NAMES.filter((name) => !PER_ZONE.includes(name));
const MAPPED = Object.values(WIRING).flatMap((group) =>
  Object.entries(group).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
);

const declared = (rule: Declarations, prefix: string) =>
  rule.filter(([name]) => name.startsWith(prefix)).map(([name]) => name);
const reads = (value: string, prefix: string) =>
  [...value.matchAll(/--[a-z0-9-]+/g)].map(([name]) => name).filter((n) => n.startsWith(prefix));

function ruleOf(selector: string): Declarations {
  const rule = RULES.get(selector);
  if (rule === undefined) throw new Error(`the generated blocks have no rule ${selector}`);
  return rule;
}

describe('the generated blocks of host-contract.css', () => {
  it('sit between one pair of markers', () => {
    expect(SHEET.split(START)).toHaveLength(2);
    expect(SHEET.split(END)).toHaveLength(2);
    expect(SHEET.indexOf(START)).toBeLessThan(SHEET.indexOf(END));
  });

  it('are the standalone rule, its per-zone rules and one gated rule for each of the four zones', () => {
    expect(TOKENS.zones).toEqual(['white', 'g10', 'g90', 'g100']);
    expect(PER_ZONE).toEqual(['shadow-dropdown']);
    expect([...RULES.keys()]).toEqual([
      STANDALONE,
      ...TOKENS.zones.map((zone) => `.cds--${zone}`),
      ...TOKENS.zones.map(gated),
    ]);
  });

  it('declare no variable twice in one rule', () => {
    for (const [selector, rule] of RULES) {
      const names = rule.map(([name]) => name);
      expect(names, selector).toEqual([...new Set(names)]);
    }
  });
});

describe('I-5: what each block declares', () => {
  it('has 35 contract names and a wiring that maps tokens onto them', () => {
    expect(NAMES).toHaveLength(35);
    expect(MAPPED.length).toBeGreaterThan(0);
  });

  it('declares exactly the tokens.json names in the standalone block, and nothing else', () => {
    const rule = ruleOf(STANDALONE);

    expect(declared(rule, '--canopy-')).toEqual(UNIFORM.map((name) => `--canopy-${name}`));
    expect(rule).toHaveLength(UNIFORM.length);
    for (const zone of TOKENS.zones) {
      const own = ruleOf(`.cds--${zone}`);
      expect(declared(own, '--canopy-'), zone).toEqual(PER_ZONE.map((name) => `--canopy-${name}`));
      expect(own, zone).toHaveLength(PER_ZONE.length);
    }
  });

  it.each(['white', 'g10', 'g90', 'g100'])(
    'declares exactly the tokens.json names in the gated %s rule',
    (zone) => {
      expect(declared(ruleOf(gated(zone)), '--canopy-')).toEqual(CONTRACT_NAMES);
    }
  );

  it.each(['white', 'g10', 'g90', 'g100'])(
    'declares exactly the mapped wiring set in the gated %s rule, with its expressions',
    (zone) => {
      const rule = ruleOf(gated(zone));
      const carbon = rule.filter(([name]) => name.startsWith('--cds-'));

      expect([...carbon].sort()).toEqual([...MAPPED].sort());
      expect(rule).toHaveLength(NAMES.length + MAPPED.length);
    }
  );

  it('declares no token the wiring leaves to Carbon', () => {
    const kept = Object.values(WIRING).flatMap((group) =>
      Object.keys(group).filter((token) => typeof group[token] !== 'string')
    );
    expect(kept.length).toBeGreaterThan(0);

    for (const zone of TOKENS.zones) {
      const carbon = new Set(declared(ruleOf(gated(zone)), '--cds-'));
      expect(kept.filter((token) => carbon.has(token))).toEqual([]);
    }
  });
});

describe('I-4: the gated block has no cycle', () => {
  it.each(['white', 'g10', 'g90', 'g100'])(
    'reads no Carbon token from a contract name in the gated %s rule',
    (zone) => {
      const offenders = ruleOf(gated(zone)).filter(
        ([name, value]) => name.startsWith('--canopy-') && value.includes('--cds-')
      );

      expect(offenders).toEqual([]);
    }
  );

  it.each(['white', 'g10', 'g90', 'g100'])(
    'reads only contract names it declares from a Carbon token in the gated %s rule',
    (zone) => {
      const rule = ruleOf(gated(zone));
      const own = new Set(declared(rule, '--canopy-'));
      const carbon = rule.filter(([name]) => name.startsWith('--cds-'));

      for (const [name, value] of carbon) {
        const read = reads(value, '--canopy-');
        expect(read.length, name).toBeGreaterThan(0);
        expect(
          read.filter((contractName) => !own.has(contractName)),
          name
        ).toEqual([]);
        // A hosted Carbon token that read another one could close a cycle through block 1.
        expect(reads(value, '--cds-'), name).toEqual([]);
      }
    }
  );
});

describe('the literals of the blocks', () => {
  it('alias each colour name to its Carbon token standalone, and fix the others', () => {
    const rule = new Map(ruleOf(STANDALONE));

    for (const name of UNIFORM) {
      const { alias, literals } = TOKENS.names[name];
      expect(rule.get(`--canopy-${name}`), name).toBe(
        alias === null ? literals.white : `var(--cds-${alias})`
      );
    }
    for (const zone of TOKENS.zones) {
      const own = new Map(ruleOf(`.cds--${zone}`));
      for (const name of PER_ZONE) {
        expect(own.get(`--canopy-${name}`), `${zone} ${name}`).toBe(
          TOKENS.names[name].literals[zone]
        );
      }
    }
  });

  it('reads no layout constant standalone, which the gated block rewires', () => {
    expect(ruleOf(STANDALONE).filter(([, value]) => value.includes('--cds-layout-'))).toEqual([]);
  });

  it.each(['white', 'g10', 'g90', 'g100'])(
    'falls back from the host value to the %s literal of tokens.json',
    (zone) => {
      const rule = new Map(ruleOf(gated(zone)));

      for (const name of NAMES) {
        expect(rule.get(`--canopy-${name}`), name).toBe(
          `var(--canopy-host-${name}, ${TOKENS.names[name].literals[zone]})`
        );
      }
    }
  );

  it('lists under each name the Carbon tokens the gated block drives with it', () => {
    const rule = ruleOf(gated('white')).filter(([name]) => name.startsWith('--cds-'));

    for (const name of NAMES) {
      const driven = rule
        .filter(([, value]) => reads(value, '--canopy-').includes(`--canopy-${name}`))
        .map(([token]) => token.slice('--cds-'.length))
        .sort();
      expect(TOKENS.names[name].drives, name).toEqual(driven);
    }
  });
});
