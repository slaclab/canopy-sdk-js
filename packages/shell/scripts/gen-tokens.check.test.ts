// `gen-tokens --check` and the wiring map it guards. `wiring.json` must map every token the
// compiled Carbon stylesheet enumerates and nothing else, group by group; a disagreement in
// either direction fails the check and names the token.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALIAS_REASON,
  CONTRACT,
  PATHS,
  WIRING_GROUPS,
  checkWiring,
  enumerateTokens,
  parseStylesheet,
  readCarbonStylesheet,
} from './gen-tokens.mjs';

type Entry = string | { carbon: string };
type Wiring = Record<string, Record<string, Entry>>;

const GENERATOR = join(dirname(fileURLToPath(import.meta.url)), 'gen-tokens.mjs');
const CSS = readCarbonStylesheet();
const PARSED = parseStylesheet(CSS);

/** A fresh copy of the committed wiring map, optionally edited. */
function wiring(edit: (document: Wiring) => void = () => {}): Wiring {
  const document = JSON.parse(readFileSync(PATHS.wiring, 'utf8')) as Wiring;
  edit(document);
  return document;
}

describe('the committed wiring map', () => {
  it('has the three groups and passes the check', () => {
    const committed = wiring();

    expect(Object.keys(committed)).toEqual(WIRING_GROUPS);
    expect(() => checkWiring(committed, PARSED)).not.toThrow();
  });

  it('maps exactly the enumerated tokens of each group', () => {
    const committed = wiring();
    const enumerated = enumerateTokens(PARSED);

    for (const group of WIRING_GROUPS) {
      expect(Object.keys(committed[group]).sort()).toEqual([...enumerated[group]].sort());
    }
    expect(enumerated.zone).toHaveLength(327);
    expect(enumerated.type).toHaveLength(21);
    expect(enumerated.layout).toEqual([
      '--cds-layout-size-height-sm',
      '--cds-layout-size-height-xs',
    ]);
  });

  it('marks every context alias as Carbon-derived', () => {
    const { zone } = wiring();

    expect(Object.keys(PARSED.aliases)).toHaveLength(15);
    for (const alias of Object.keys(PARSED.aliases)) {
      expect(zone[alias]).toEqual({ carbon: ALIAS_REASON });
    }
  });

  it('gives a reason for every token left to Carbon', () => {
    const committed = wiring();

    for (const group of WIRING_GROUPS) {
      for (const [token, entry] of Object.entries(committed[group])) {
        if (typeof entry === 'string') continue;
        expect(Object.keys(entry), token).toEqual(['carbon']);
        expect(entry.carbon.trim(), token).not.toBe('');
      }
    }
  });

  it('wires only through contract names, never through another Carbon token', () => {
    const names = new Set(CONTRACT.map(([name]) => name));
    const committed = wiring();

    for (const group of WIRING_GROUPS) {
      for (const [token, entry] of Object.entries(committed[group])) {
        if (typeof entry !== 'string') continue;
        expect(entry, token).not.toContain('--cds-');
        const references = [...entry.matchAll(/--canopy-([a-z0-9-]+)/g)].map((match) => match[1]);
        expect(references.length, token).toBeGreaterThan(0);
        for (const name of references) expect(names.has(name), `${token}: ${name}`).toBe(true);
      }
    }
  });

  it('carries the seed mapping', () => {
    const { zone, type, layout } = wiring();
    const mix = (a: string, b: string, pct: number) =>
      `color-mix(in srgb, var(--canopy-${a}), var(--canopy-${b}) ${pct}%)`;
    const disabledOnColor =
      'color-mix(in srgb, var(--canopy-text-muted) 60%, var(--canopy-bg-panel))';

    expect(zone['--cds-interactive']).toBe('var(--canopy-accent)');
    expect(zone['--cds-button-primary-hover']).toBe('var(--canopy-accent-hover)');
    expect(zone['--cds-button-primary-active']).toBe(
      'color-mix(in srgb, var(--canopy-accent), #000 24%)'
    );
    // The secondary ladder rises off its surface, so Cancel shows at rest on an elevated dialog.
    expect(zone['--cds-button-secondary']).toBe(mix('bg-elevated', 'text-primary', 12));
    expect(zone['--cds-button-secondary-hover']).toBe(mix('bg-elevated', 'text-primary', 20));
    expect(zone['--cds-button-secondary-active']).toBe(mix('bg-elevated', 'text-primary', 28));
    // The toggle knob reads icon-on-color: it follows the host's on-accent, like the text.
    expect(zone['--cds-text-on-color']).toBe('var(--canopy-on-accent)');
    expect(zone['--cds-icon-on-color']).toBe('var(--canopy-on-accent)');
    expect(zone['--cds-text-on-color-disabled']).toBe(disabledOnColor);
    expect(zone['--cds-icon-on-color-disabled']).toBe(disabledOnColor);
    expect(zone['--cds-background']).toBe('var(--canopy-bg-base)');
    expect(zone['--cds-layer-01']).toBe('var(--canopy-bg-panel)');
    expect(zone['--cds-layer-02']).toBe('var(--canopy-bg-elevated)');
    expect(zone['--cds-border-subtle-00']).toBe('var(--canopy-border)');
    expect(zone['--cds-border-inverse']).toBe('var(--canopy-border-strong)');
    expect(zone['--cds-toggle-off']).toBe('var(--canopy-text-muted)');
    expect(zone['--cds-support-error']).toBe('var(--canopy-status-error)');
    expect(zone['--cds-background-inverse']).toBe('var(--canopy-text-primary)');
    expect(zone['--cds-text-inverse']).toBe('var(--canopy-bg-base)');
    expect(zone['--cds-button-danger-primary']).toHaveProperty('carbon');
    expect(zone['--cds-tag-background-blue']).toHaveProperty('carbon');

    expect(type['--cds-body-compact-01-font-size']).toBe('var(--canopy-text-md)');
    expect(type['--cds-label-01-font-size']).toBe('var(--canopy-text-sm)');
    expect(type['--cds-heading-02-font-size']).toBe('var(--canopy-text-lg)');
    expect(type['--cds-code-01-font-family']).toBe('var(--canopy-font-mono)');
    expect(type['--cds-code-02-font-family']).toBe('var(--canopy-font-mono)');
    expect(type['--cds-heading-03-font-size']).toEqual({
      carbon: 'display sizes, unused in these apps',
    });

    expect(layout).toEqual({
      '--cds-layout-size-height-sm': 'var(--canopy-control-h-sm)',
      '--cds-layout-size-height-xs': 'var(--canopy-control-h-xs)',
    });
  });

  it('never wires a solid resting background to a translucent tint', () => {
    const { zone } = wiring();

    for (const level of ['01', '02', '03']) {
      expect(zone[`--cds-field-hover-${level}`]).toBe(
        'color-mix(in srgb, var(--canopy-bg-field), var(--canopy-text-primary) 8%)'
      );
      expect(zone[`--cds-layer-active-${level}`]).toBe(
        'color-mix(in srgb, var(--canopy-bg-panel), var(--canopy-text-primary) 12%)'
      );
      // Readers that rest transparent over their container do take the tint.
      expect(zone[`--cds-layer-hover-${level}`]).toBe('var(--canopy-hover-tint)');
      expect(zone[`--cds-layer-selected-${level}`]).toBe('var(--canopy-accent-tint)');
    }
  });
});

describe('checkWiring', () => {
  const SAMPLE = {
    zone: '--cds-interactive',
    type: '--cds-label-01-font-size',
    layout: '--cds-layout-size-height-sm',
  } as const;

  it.each(WIRING_GROUPS as (keyof typeof SAMPLE)[])(
    'names an enumerated %s token the map leaves out',
    (group) => {
      const broken = wiring((document) => {
        delete document[group][SAMPLE[group]];
      });

      expect(() => checkWiring(broken, PARSED)).toThrow(
        `gen-tokens: wiring.json group "${group}" does not map ${SAMPLE[group]}`
      );
    }
  );

  it.each(WIRING_GROUPS)('names a %s key outside the enumeration', (group) => {
    const broken = wiring((document) => {
      document[group]['--cds-not-a-carbon-token'] = { carbon: 'stray' };
    });

    expect(() => checkWiring(broken, PARSED)).toThrow(
      `gen-tokens: wiring.json group "${group}" maps --cds-not-a-carbon-token, which the stylesheet does not enumerate`
    );
  });

  it('compares group by group: a zone token filed under type is a stray key there', () => {
    const broken = wiring((document) => {
      document.type['--cds-interactive'] = document.zone['--cds-interactive'];
    });

    expect(() => checkWiring(broken, PARSED)).toThrow(
      'wiring.json group "type" maps --cds-interactive, which the stylesheet does not enumerate'
    );
  });

  it('follows the stylesheet: a token Carbon adds fails until it is mapped', () => {
    const grown = parseStylesheet(
      CSS.replace(/(\.cds--g100\s*\{)/, '$1--cds-brand-new-token:#010203;')
    );

    expect(grown.zoneTokens).toContain('--cds-brand-new-token');
    expect(() => checkWiring(wiring(), grown)).toThrow(
      'wiring.json group "zone" does not map --cds-brand-new-token'
    );
  });

  it('refuses a missing group and an unknown one', () => {
    expect(() =>
      checkWiring(
        wiring((document) => {
          delete document.layout;
        }),
        PARSED
      )
    ).toThrow('gen-tokens: wiring.json has no group "layout"');
    expect(() =>
      checkWiring(
        wiring((document) => {
          document.colour = {};
        }),
        PARSED
      )
    ).toThrow('gen-tokens: wiring.json has an unknown group "colour"');
    expect(() => checkWiring([], PARSED)).toThrow('wiring.json is not an object of groups');
  });

  it.each([
    ['an empty reason', { carbon: ' ' }, 'to Carbon without a reason'],
    ['a second key', { carbon: 'kept', also: 'x' }, 'to an object that is not { "carbon"'],
    ['an empty expression', '', 'to neither a contract expression nor'],
    ['a number', 3, 'to neither a contract expression nor'],
    ['a literal colour', '#0f62fe', 'to an expression that reads no contract name'],
    ['an unknown contract name', 'var(--canopy-brand)', 'to --canopy-brand, which is not a'],
    ['a Carbon read', 'var(--cds-layer-01)', 'to an expression that reads a Carbon token'],
  ])('refuses an entry with %s, naming the token', (_label, entry, message) => {
    const broken = wiring((document) => {
      document.zone['--cds-interactive'] = entry as Entry;
    });

    expect(() => checkWiring(broken, PARSED)).toThrow(
      `wiring.json group "zone" maps --cds-interactive ${message}`
    );
  });

  it('refuses to wire a context alias, which follows its -0x token', () => {
    const broken = wiring((document) => {
      document.zone['--cds-layer'] = 'var(--canopy-bg-panel)';
    });

    expect(() => checkWiring(broken, PARSED)).toThrow(
      'maps --cds-layer to an expression, but it is a context alias of --cds-layer-01'
    );
  });
});

describe('gen-tokens --check as a script', () => {
  const made: string[] = [];

  /** A package holding a copy of the generator, the pinned stylesheet and the given wiring. */
  function tempPackage(document: Wiring | string | null): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gen-tokens-check-')));
    made.push(dir);
    const carbon = join(dir, 'node_modules', '@carbon', 'styles');
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(carbon, 'css'), { recursive: true });
    copyFileSync(GENERATOR, join(dir, 'scripts', 'gen-tokens.mjs'));
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(
      join(carbon, 'package.json'),
      '{ "name": "@carbon/styles", "version": "0.0.0" }\n'
    );
    // The @carbon/react whose @carbon/styles the generator compares against (the same one here).
    mkdirSync(join(dir, 'node_modules', '@carbon', 'react'));
    writeFileSync(
      join(dir, 'node_modules', '@carbon', 'react', 'package.json'),
      '{ "name": "@carbon/react", "version": "0.0.0" }\n'
    );
    writeFileSync(join(carbon, 'css', 'styles.css'), CSS);
    if (document !== null) {
      writeFileSync(
        join(dir, 'wiring.json'),
        typeof document === 'string' ? document : JSON.stringify(document)
      );
    }
    return dir;
  }

  function check(script: string): { status: number; stderr: string } {
    try {
      execFileSync(process.execPath, [script, '--check'], { cwd: tmpdir(), stdio: 'pipe' });
      return { status: 0, stderr: '' };
    } catch (error) {
      const failure = error as { status: number; stderr: Buffer };
      return { status: failure.status, stderr: failure.stderr.toString() };
    }
  }

  const checkIn = (dir: string) => check(join(dir, 'scripts', 'gen-tokens.mjs'));

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('passes on the committed package from any working directory, writing nothing', () => {
    const before = readFileSync(PATHS.tokens, 'utf8');
    const strayOutputs = ['tokens.json', 'wiring.json', 'host-contract.css'].map((name) =>
      join(tmpdir(), name)
    );
    const strayBefore = strayOutputs.map((path) => existsSync(path));

    expect(check(GENERATOR)).toEqual({ status: 0, stderr: '' });

    expect(readFileSync(PATHS.tokens, 'utf8')).toBe(before);
    expect(strayOutputs.map((path) => existsSync(path))).toEqual(strayBefore);
  });

  it('passes on a complete wiring and writes no artefact', () => {
    const dir = tempPackage(wiring());

    expect(checkIn(dir)).toEqual({ status: 0, stderr: '' });
    expect(readdirSync(dir).sort()).toEqual([
      'node_modules',
      'package.json',
      'scripts',
      'wiring.json',
    ]);
  });

  it('exits non-zero naming an enumerated token the wiring does not map', () => {
    const dir = tempPackage(
      wiring((document) => {
        delete document.zone['--cds-toggle-off'];
      })
    );

    const result = checkIn(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'gen-tokens: wiring.json group "zone" does not map --cds-toggle-off'
    );
  });

  it('exits non-zero naming a wiring key the stylesheet does not enumerate', () => {
    const dir = tempPackage(
      wiring((document) => {
        document.zone['--cds-retired-token'] = 'var(--canopy-accent)';
      })
    );

    const result = checkIn(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'gen-tokens: wiring.json group "zone" maps --cds-retired-token, which the stylesheet does not enumerate'
    );
  });

  it('exits non-zero when wiring.json is absent or is not JSON', () => {
    const absent = checkIn(tempPackage(null));
    const garbled = checkIn(tempPackage('{ "zone": '));

    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain('gen-tokens: cannot read');
    expect(garbled.status).toBe(1);
    expect(garbled.stderr).toContain('wiring.json is not JSON');
  });
});
