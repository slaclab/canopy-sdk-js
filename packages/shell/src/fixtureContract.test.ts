// The shared host fixtures (`fixtures/host/*`) against the contract they test: the probe rows,
// the synthetic host stylesheet and its values, the link template, the setups and the probe
// runner. The fixtures are consumed by other repositories, where a name that drifted from
// `tokens.json` or `wiring.json` would only show as a failing browser test far from its cause.

import { afterEach, describe, expect, it } from 'vitest';
import * as runner from '../fixtures/host/runner.mjs';
import type {
  HostFixture,
  HostProbes,
  ProbeRow,
  Target,
  ContractTokens,
} from '../fixtures/host/runner.mjs';
import * as setups from '../fixtures/host/setups.mjs';
import type { PageLike } from '../fixtures/host/setups.mjs';
import { HOST_THEME_ID, modeFromThemeId } from './useHostTheme.js';

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

interface Tokens extends ContractTokens {
  contract: number;
}
type Wiring = Record<string, Record<string, string | { carbon: string }>>;

const TOKENS = JSON.parse(read('tokens.json')) as Tokens;
const WIRING = JSON.parse(read('wiring.json')) as Wiring;
const PROBES = JSON.parse(read('fixtures/host/hostProbes.json')) as HostProbes;
const HOST = JSON.parse(read('fixtures/host/host.json')) as HostFixture;
const HOST_CSS = read('fixtures/host/host.css');
const LINKS = read('fixtures/host/links.html');

const NAMES = Object.keys(TOKENS.names);

const SETUP_NAMES = [
  'select-first-nav-row',
  'open-write-dialog',
  'hover',
  'focus',
  'hover-action',
  'open-properties',
  'select-first-outline-row',
  'open-outline',
  'open-section-axes',
  'open-section-display',
  'open-more',
  'open-screen-tree-menu',
  'open-insight-overflow',
  'open-trace-tab',
  'open-save-view-dialog',
  'open-view-menu',
  'dock-second-tile',
  'hold-tab-drag',
];

const LONGHANDS = [
  'background-color',
  'border-bottom-color',
  'border-bottom-width',
  'border-left-color',
  'border-left-width',
  'border-top-color',
  'border-top-left-radius',
  'color',
  'fill',
  'font-family',
  'font-size',
  'height',
  'min-height',
  'padding-top',
  'width',
  'outline-color',
  'outline-width',
];

const ROW_KEYS = [
  'app',
  'page',
  'selector',
  'pseudo',
  'setup',
  'viewport',
  'stack',
  'hare',
  'expect',
];

/** A viewer screen URL: the viewer routes only `/<category>/<id>` under `/embed` and `/s`. */
const VIEWER_PAGE = /^\/(embed|s)\/[^/?@]+\/[^?]+/;

const label = (row: ProbeRow) => `${row.app} ${row.selector}${row.pseudo ?? ''}`;
const targets = (row: ProbeRow) => Object.entries(row.expect) as [string, Target][];
const rowsWhere = (app: string, selector: string) =>
  PROBES.rows.filter((row) => row.app === app && row.selector === selector);

/** The rules of a stylesheet as selector → declarations, comments dropped. */
function parseRules(css: string): [selector: string, declarations: [string, string][]][] {
  const rules: [string, [string, string][]][] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = m[2]
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .map((d): [string, string] => {
        const colon = d.indexOf(':');
        return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
      });
    rules.push([m[1].trim().replace(/\s+/g, ' '), declarations]);
  }
  return rules;
}

const RULES = parseRules(HOST_CSS);

describe('hostProbes.json', () => {
  it('names a default page for each app, and nothing else', () => {
    expect(Object.keys(PROBES.defaults.page).sort()).toEqual([
      'correlation',
      'trace',
      'viewer',
      'waveform',
    ]);
  });

  it('has rows for every app', () => {
    for (const app of ['viewer', 'trace', 'correlation', 'waveform']) {
      expect(PROBES.rows.filter((row) => row.app === app).length, app).toBeGreaterThan(0);
    }
  });

  it('gives every row only the known keys, so none overrides its zone', () => {
    for (const row of PROBES.rows) {
      expect(
        Object.keys(row).filter((key) => !ROW_KEYS.includes(key)),
        label(row)
      ).toEqual([]);
      expect(Object.keys(PROBES.defaults.page), label(row)).toContain(row.app);
      expect(row.selector, label(row)).not.toBe('');
      expect(Array.isArray(row.setup), label(row)).toBe(true);
      expect(Object.keys(row.expect).length, label(row)).toBeGreaterThan(0);
      if (row.pseudo !== undefined) expect(['::after', '::before']).toContain(row.pseudo);
      if (row.stack !== undefined) expect(row.stack, label(row)).toBe(false);
      if (row.hare !== undefined) expect(row.hare, label(row)).toBe(true);
    }
  });

  it('names only setups that setups.mjs exports', () => {
    const exported = setups as unknown as Record<string, unknown>;
    for (const row of PROBES.rows) {
      for (const name of row.setup) {
        expect(SETUP_NAMES, label(row)).toContain(name);
        expect(typeof exported[name], `${label(row)}: ${name}`).toBe('function');
      }
    }
  });

  it('probes longhand properties only', () => {
    for (const row of PROBES.rows) {
      for (const [property] of targets(row)) {
        expect(LONGHANDS, `${label(row)}: ${property}`).toContain(property);
      }
    }
  });

  it('gives every property exactly one kind of target', () => {
    for (const row of PROBES.rows) {
      for (const [property, target] of targets(row)) {
        const at = `${label(row)}: ${property}`;
        const kinds = ['contract', 'carbon', 'literal', 'mix', 'inside'].filter(
          (kind) => kind in target
        );
        expect(kinds.length, at).toBe(1);
        const extra = Object.keys(target).filter(
          (key) => key !== kinds[0] && key !== 'hostOnly' && key !== 'standalone'
        );
        expect(extra, at).toEqual([]);
        expect(typeof (target as unknown as Record<string, unknown>)[kinds[0]], at).toBe('string');
        if ('hostOnly' in target) {
          expect(target.hostOnly, at).toBe(true);
          expect(['contract', 'literal'], at).toContain(kinds[0]);
        }
        if ('standalone' in target) {
          expect(['contract', 'mix'], at).toContain(kinds[0]);
          expect(Object.keys(target.standalone ?? {}), at).toEqual(['carbon']);
        }
        // Geometry reads the element's box, which a pseudo-element has none of in the DOM.
        if (kinds[0] === 'inside') {
          expect(property, at).toBe('width');
          expect(row.pseudo, at).toBeUndefined();
        }
      }
    }
  });

  it('refers to contract names of tokens.json', () => {
    for (const row of PROBES.rows) {
      for (const [property, target] of targets(row)) {
        if ('contract' in target) {
          expect(NAMES, `${label(row)}: ${property}`).toContain(target.contract);
        }
      }
    }
  });

  it('refers to Carbon tokens that are zone keys of wiring.json', () => {
    const zoneKeys = Object.keys(WIRING.zone);
    let seen = 0;
    for (const row of PROBES.rows) {
      for (const [property, target] of targets(row)) {
        const tokens = [];
        if ('carbon' in target) tokens.push(target.carbon);
        if ('standalone' in target && target.standalone) tokens.push(target.standalone.carbon);
        for (const token of tokens) {
          seen += 1;
          expect(zoneKeys, `${label(row)}: ${property}`).toContain(`--cds-${token}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('mixes only contract variables', () => {
    let seen = 0;
    for (const row of PROBES.rows) {
      for (const [property, target] of targets(row)) {
        if (!('mix' in target)) continue;
        const at = `${label(row)}: ${property}`;
        expect(target.mix, at).toMatch(/^color-mix\(.+\)$/);
        const variables = [...target.mix.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
        expect(variables.length, at).toBeGreaterThan(0);
        for (const variable of variables) {
          seen += 1;
          expect(variable.startsWith('--canopy-'), `${at}: ${variable}`).toBe(true);
          expect(NAMES, `${at}: ${variable}`).toContain(variable.slice('--canopy-'.length));
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('writes every page as an absolute path with a theme placeholder', () => {
    const pages = [
      ...Object.values(PROBES.defaults.page),
      ...PROBES.rows.flatMap((row) => (row.page === undefined ? [] : [row.page])),
    ];
    for (const page of pages) {
      expect(page.startsWith('/'), page).toBe(true);
      expect(page.startsWith('//'), page).toBe(false);
      expect(page, page).toContain('theme={theme}');
      expect(page, page).toContain('embedded=true');
    }
  });

  it('writes every viewer page as a /<category>/<id> screen URL', () => {
    expect(PROBES.defaults.page.viewer).toMatch(VIEWER_PAGE);
    expect(PROBES.defaults.page.viewer.startsWith('/embed/drafts/host-probe?')).toBe(true);
    for (const row of PROBES.rows) {
      if (row.app === 'viewer' && row.page !== undefined) {
        expect(row.page, label(row)).toMatch(VIEWER_PAGE);
      }
    }
  });

  it('runs the write-dialog rows on the write-probe draft, off the deployed stack', () => {
    const rows = PROBES.rows.filter((row) => row.setup.includes('open-write-dialog'));
    expect(rows.length).toBeGreaterThan(0);
    expect(setups.WRITE_PROBE_PAGE.startsWith('/embed/drafts/write-probe?')).toBe(true);
    for (const row of rows) {
      expect(row.app, label(row)).toBe('viewer');
      expect(row.page, label(row)).toBe(setups.WRITE_PROBE_PAGE);
      expect(row.setup[0], label(row)).toBe('open-write-dialog');
      expect(row.stack, label(row)).toBe(false);
    }
  });

  it('opens the Trace tab for the Save-view button', () => {
    const rows = rowsWhere('viewer', '.save-view__button');
    expect(rows.map((row) => row.setup)).toEqual([['open-trace-tab']]);
  });

  it('probes the danger menu item hovered in a saved view menu, off the deployed stack', () => {
    const rows = rowsWhere('viewer', '.cds--menu-item--danger');
    expect(rows.map((row) => row.setup)).toEqual([['open-view-menu', 'hover']]);
    expect(rows[0].stack).toBe(false);
  });

  it('runs the connector badge under a hare backend', () => {
    const rows = rowsWhere('viewer', '.target-badge[role=status]');
    expect(rows.map((row) => row.hare)).toEqual([true]);
  });

  it('holds no PV check: the add row has no Add button to disable (A30)', () => {
    const exported = setups as unknown as Record<string, unknown>;
    expect(exported['hold-pv-check']).toBeUndefined();
    expect(Object.keys(setups.postconditions)).not.toContain('hold-pv-check');
    // The Hare-hold PV stays: host-smoke's mock still holds it.
    expect(setups.HOLD_PV).toBe('SR:HOLD');
  });

  it('probes the bar and the × of the one tile with no setup, so on the deployed stack too', () => {
    for (const selector of ['.canopy-tile-bar', '.canopy-tile-bar__close']) {
      const rows = rowsWhere('viewer', selector);
      expect(
        rows.map((row) => [row.setup, row.stack]),
        selector
      ).toEqual([[[], undefined]]);
    }
    expect(Object.keys(rowsWhere('viewer', '.canopy-tile-bar')[0].expect).sort()).toEqual([
      'background-color',
      'border-bottom-color',
    ]);
    expect(rowsWhere('viewer', '.canopy-tile-bar__close')[0].expect).toEqual({
      color: { contract: 'text-secondary' },
    });
  });

  it('docks a second tile for the title and the focused hairline, off the deployed stack', () => {
    const rows = PROBES.rows.filter((row) => row.setup.includes('dock-second-tile'));
    expect(rows.map((row) => [row.app, row.selector, row.setup, row.stack])).toEqual([
      ['viewer', '[data-testid=tile-bar-title]', ['dock-second-tile'], false],
      ['viewer', '.canopy-tile-bar--focused', ['dock-second-tile'], false],
      ['viewer', '.dv-drop-target-anchor', ['dock-second-tile', 'hold-tab-drag'], false],
    ]);
    expect(rows[0].expect).toEqual({ 'font-family': { contract: 'font-ui' } });
    expect(rows[1].expect).toEqual({ 'border-top-color': { contract: 'accent' } });
    // One tile is the state every other viewer row expects: no row on the default page may
    // reach two tiles and stay on the stack, whose rows share one browser context.
    for (const row of rows) expect(row.page, label(row)).toBeUndefined();
  });

  it('holds a tab drag over the second tile for the drop highlight, and releases it', () => {
    const rows = PROBES.rows.filter((row) => row.setup.includes('hold-tab-drag'));
    expect(rows.map((row) => [row.selector, row.setup, row.stack, row.expect])).toEqual([
      [
        '.dv-drop-target-anchor',
        ['dock-second-tile', 'hold-tab-drag'],
        false,
        {
          // The drop preview is a fifth of the accent over the tile (the
          // host's accent-tint is its selection tint, too faint for a target), edged in it.
          'background-color': { mix: 'color-mix(in srgb, var(--canopy-accent) 20%, transparent)' },
          'border-top-color': { contract: 'accent' },
        },
      ],
    ]);
    expect(typeof setups.postconditions['hold-tab-drag']).toBe('function');
    expect(setups.postconditions['dock-second-tile']).toBeUndefined();
  });

  it('adds no token for the dock rows', () => {
    expect(NAMES.length).toBe(27);
  });

  it('probes the Trace action at a 600 px viewport too', () => {
    const rows = rowsWhere('trace', '[data-testid=actions-bar] .cds--btn--icon-only');
    expect(rows.map((row) => row.viewport?.width)).toEqual([undefined, 600]);
  });

  it('probes no Trace chrome the workbench retired', () => {
    // The side panels, the Carbon header and its Live/Archive counts are gone (A12, A39).
    const retired = [
      '.properties-panel',
      '.layers-panel',
      '.trace-resize-handle',
      '.trace-header',
      'header[aria-label=Trace]',
      '.cds--header',
    ];
    for (const row of PROBES.rows.filter((r) => r.app === 'trace')) {
      for (const selector of retired) expect(row.selector, label(row)).not.toContain(selector);
      expect(row.setup, label(row)).not.toContain('hover-header-action');
    }
  });

  it('probes the Trace actions bar, its action and its tooltip as the header rows were (A39)', () => {
    const bar = rowsWhere('trace', '[data-testid=actions-bar]');
    expect(bar.map((row) => [row.setup, row.expect])).toEqual([
      [
        [],
        {
          height: { contract: 'control-h-sm', hostOnly: true },
          // The bar paints Carbon's layer, not its background, when no host is present.
          'background-color': { contract: 'bg-panel', standalone: { carbon: 'layer' } },
          'border-bottom-color': { contract: 'border', standalone: { carbon: 'border-subtle' } },
        },
      ],
    ]);
    const size = { contract: 'control-h-sm', hostOnly: true };
    for (const row of rowsWhere('trace', '[data-testid=actions-bar] .cds--btn--icon-only')) {
      expect(row.setup, label(row)).toEqual([]);
      expect(row.expect, label(row)).toEqual({ height: size, 'min-height': size, width: size });
    }
    const tooltip = rowsWhere('trace', '[data-testid=actions-bar] .cds--popover-content');
    expect(tooltip.map((row) => row.setup)).toEqual([['hover-action']]);
    expect(rowsWhere('trace', '.cds--overflow-menu-options').map((row) => row.setup)).toEqual([
      ['open-insight-overflow'],
    ]);
  });

  it('opens Waveform beside the Trace pages, embedded, themed and with a live PV', () => {
    const page = PROBES.defaults.page.waveform;
    expect(page.startsWith('/waveform.html?')).toBe(true);
    const query = new URLSearchParams(page.slice(page.indexOf('?') + 1));
    expect(query.get('embedded')).toBe('true');
    expect(query.get('theme')).toBe('{theme}');
    expect(query.getAll('pv').length).toBeGreaterThan(0);
    for (const pv of query.getAll('pv')) expect(pv).not.toBe('');
    // The page renders from the Hare mock alone: no row needs a page of its own or a backend.
    for (const row of PROBES.rows.filter((r) => r.app === 'waveform')) {
      expect(row.page, label(row)).toBeUndefined();
      expect(row.hare, label(row)).toBeUndefined();
    }
  });

  it("probes the Waveform actions bar, its action and its tooltip as Trace's (A39)", () => {
    // Same place, same widget: a third tool's bar holds the very rows Trace's does.
    for (const selector of [
      '[data-testid=actions-bar]',
      '[data-testid=actions-bar] .cds--btn--icon-only',
      '[data-testid=actions-bar] .cds--popover-content',
    ]) {
      const trace = rowsWhere('trace', selector).filter((row) => row.viewport === undefined);
      const waveform = rowsWhere('waveform', selector);
      expect(waveform.length, selector).toBe(1);
      expect(
        waveform.map((row) => [row.setup, row.expect, row.viewport]),
        selector
      ).toEqual(trace.map((row) => [row.setup, row.expect, row.viewport]));
    }
  });

  it('keeps the Trace page as it was', () => {
    expect(PROBES.defaults.page.trace).toBe('/?embedded=true&theme={theme}&pv=SR:TEST&range=-10m');
  });

  it('probes Correlation on its workbench, not on PvPicker or the canvas toolbar', () => {
    const correlation = PROBES.rows.filter((row) => row.app === 'correlation');
    expect(correlation.map((row) => [row.selector, row.pseudo, row.setup])).toEqual([
      ['[data-testid=outline-add-input]', undefined, ['open-outline']],
      ['[data-testid=trigger-source]', undefined, ['open-outline']],
      ['#density-y', undefined, ['open-properties', 'open-section-display']],
      ['[data-testid=trigger-source]', undefined, ['open-outline', 'hover']],
      ['[data-testid=actions-bar]', undefined, []],
      ['[data-testid=actions-bar] .cds--btn--icon-only', undefined, []],
      ['[data-testid=actions-bar] .cds--popover-content', undefined, ['hover-action']],
      [
        '#y-layout .wb-segmented__option + .wb-segmented__option',
        undefined,
        ['open-properties', 'open-section-axes'],
      ],
      ['#role', undefined, ['select-first-outline-row', 'open-properties']],
    ]);
    const retired = [
      'pv-picker',
      'density-y-select',
      '.correlation-plot__toolbar',
      '.cds--content-switcher',
    ];
    for (const row of correlation) {
      for (const selector of retired) expect(row.selector, label(row)).not.toContain(selector);
      expect(row.setup, label(row)).not.toContain('hold-pv-check');
      expect(row.setup, label(row)).not.toContain('switch-density-view');
      // Nothing is held any more, so every row runs on the deployed stack too.
      expect(row.stack, label(row)).toBeUndefined();
    }
  });

  it('probes the Correlation fields with the field look of the controls they replace', () => {
    // The add row's input took the PV picker's input, the Trigger header's inline Source took
    // its Source select (the one place the Source shows), #density-y the toolbar's Density Y.
    const look = rowsWhere('correlation', '[data-testid=outline-add-input]')[0].expect;
    expect(Object.keys(look)).toEqual([
      'height',
      'border-top-left-radius',
      'background-color',
      'border-bottom-color',
      'border-bottom-width',
      'font-family',
      'font-size',
    ]);
    for (const selector of ['#density-y', '#role']) {
      expect(
        rowsWhere('correlation', selector).map((row) => row.expect),
        selector
      ).toEqual([look]);
    }
    const source = rowsWhere('correlation', '[data-testid=trigger-source]');
    expect(source.map((row) => row.setup.includes('hover'))).toEqual([false, true]);
    expect(source[0].expect).toEqual(look);
    expect(source[1].expect).toEqual({
      'background-color': {
        mix: 'color-mix(in srgb, var(--canopy-bg-field), var(--canopy-text-primary) 8%)',
        standalone: { carbon: 'field-hover-01' },
      },
    });
  });

  it("probes the Correlation actions bar, its action and its tooltip as Trace's (A39)", () => {
    for (const selector of [
      '[data-testid=actions-bar]',
      '[data-testid=actions-bar] .cds--btn--icon-only',
      '[data-testid=actions-bar] .cds--popover-content',
    ]) {
      const trace = rowsWhere('trace', selector).filter((row) => row.viewport === undefined);
      const correlation = rowsWhere('correlation', selector);
      expect(correlation.length, selector).toBe(1);
      expect(
        correlation.map((row) => [row.setup, row.expect, row.viewport]),
        selector
      ).toEqual(trace.map((row) => [row.setup, row.expect, row.viewport]));
    }
  });

  it('opens every Correlation page on keys the flat query parser reads', () => {
    // src/correlation/query.ts: x, y (repeated), dt, n, lookback, view, axes; embedded and
    // theme are the host's and ignored by the parser.
    const known = ['embedded', 'theme', 'x', 'y', 'trig', 'dt', 'n', 'lookback', 'view', 'axes'];
    const pages = [
      PROBES.defaults.page.correlation,
      ...PROBES.rows.filter((r) => r.app === 'correlation' && r.page).map((r) => r.page as string),
    ];
    expect(pages.length).toBe(2);
    for (const page of pages) {
      expect(page.startsWith('/correlation.html?'), page).toBe(true);
      const query = new URLSearchParams(page.slice(page.indexOf('?') + 1));
      for (const key of query.keys()) expect(known, `${page}: ${key}`).toContain(key);
      expect(query.get('embedded')).toBe('true');
      expect(query.get('theme')).toBe('{theme}');
      expect(query.getAll('x')).toEqual(['PROBE:X']);
      expect(query.getAll('y')).toEqual(['PROBE:Y1', 'PROBE:Y2']);
      expect(['scatter', 'density']).toContain(query.get('view'));
      expect(['shared', 'overlay', 'split']).toContain(query.get('axes'));
    }
    // #density-y shows only in the density view; Y layout only in the scatter view.
    expect(rowsWhere('correlation', '#density-y')[0].page).toContain('&view=density&');
    expect(PROBES.defaults.page.correlation).toContain('&view=scatter&');
    expect(
      rowsWhere('correlation', '#y-layout .wb-segmented__option + .wb-segmented__option')[0].page
    ).toBeUndefined();
  });

  it('retires only the header-counts row of the Trace header (A39)', () => {
    expect(PROBES.rows.filter((row) => row.selector.includes('counts'))).toEqual([]);
    expect(PROBES.rows.filter((row) => row.app === 'trace').length).toBe(21);
  });

  it('opens the plot-level Trace rows on a page with no curve', () => {
    // The plot's fields read the same with or without a curve; the page keeps the rows short.
    for (const selector of ['#plot-title', '#grid-style']) {
      const rows = PROBES.rows.filter((row) => row.app === 'trace' && row.selector === selector);
      expect(rows.length, selector).toBe(1);
      expect(rows[0].page, selector).toBe('/?embedded=true&theme={theme}&range=-10m');
    }
  });

  it('opens the panel, then the card or section that holds it, for every Trace panel row', () => {
    // A field lives in the panel under its #id (the swatch under its testid): a curve field in
    // the curve's card, opened first; a plot field in its plot-wide section, opened after the
    // panel, a "More" field after that. The composed setups are idempotent (r2 CC-10).
    const curve = ['select-first-outline-row', 'open-properties'];
    const display = ['open-properties', 'open-section-display'];
    const expected: [string, string | undefined, string[]][] = [
      ['#plot-title', undefined, display],
      ['#grid-style', undefined, [...display, 'open-more']],
      ['.cds--toggle:has(#show-symbols) .cds--toggle__switch', undefined, curve],
      ['.cds--toggle:has(#show-symbols) .cds--toggle__switch', '::before', curve],
      ['#display-name', undefined, curve],
      ['.cds--toggle:has(#show-symbols) .cds--toggle__text', undefined, curve],
      ['.wb-panel .wb-field__label', undefined, display],
      ['[data-testid=trace-color-swatch]', undefined, curve],
    ];
    const properties = PROBES.rows.filter(
      (row) => row.app === 'trace' && row.setup.includes('open-properties')
    );
    expect(properties.map((row) => [row.selector, row.pseudo, row.setup])).toEqual(expected);
    for (const row of PROBES.rows) {
      const at = row.setup.indexOf('open-properties');
      const after = row.setup.filter(
        (name) => name.startsWith('open-section-') || name === 'open-more'
      );
      for (const name of after) expect(row.setup.indexOf(name), label(row)).toBeGreaterThan(at);
    }
  });

  it('probes the row and section-heading recipes on every adopted surface', () => {
    // Rows read text-md at the tree height, headings, titles and labels text-sm. The viewer
    // selectors hold in today's tree and in the Browse tree: a member row by the data-screen-key
    // its treeitem carries, a top-level branch by the recipe class.
    const rows = {
      text: 'text-md',
      height: 'control-h-xs',
    };
    const expected: [string, string, Record<string, string>][] = [
      [
        'viewer',
        '.screen-tree [data-screen-key] > .nav-tree__row',
        { height: rows.height, 'font-size': rows.text },
      ],
      ['viewer', '.screen-tree .canopy-section-heading', { 'font-size': 'text-sm' }],
      ['trace', '.wb-sidebar__title', { 'font-size': 'text-sm' }],
      ['trace', '.wb-group__heading', { 'font-size': 'text-sm' }],
      ['trace', '.wb-outline-row', { height: rows.height, 'font-size': rows.text }],
      ['trace', '.wb-outline-row__name', { 'font-size': rows.text }],
      ['trace', '.wb-panel .wb-field__label', { 'font-size': 'text-sm' }],
    ];
    for (const [app, selector, contracts] of expected) {
      const found = rowsWhere(app, selector);
      expect(found.length, selector).toBe(1);
      expect(
        Object.fromEntries(
          targets(found[0]).map(([property, target]) => [
            property,
            'contract' in target ? target.contract : undefined,
          ])
        ),
        selector
      ).toEqual(contracts);
    }
    // The tree row probe of before stays.
    expect(rowsWhere('viewer', '.nav-tree__row').length).toBe(1);
  });

  it('keeps both footer buttons of the Save-view dialog inside its box (A2)', () => {
    // Carbon's `.cds--btn-set .cds--btn { inline-size: 100% }` pushed Cancel off the left edge.
    // The Save dialog and its Replace state are one dialog; the setup never saves.
    const footer = '.cds--modal.is-visible .cds--modal-footer';
    const rows = PROBES.rows.filter((row) => row.setup.includes('open-save-view-dialog'));
    expect(rows.map((row) => [row.app, row.selector, row.setup, row.stack, row.expect])).toEqual(
      ['secondary', 'primary'].map((kind) => [
        'viewer',
        `${footer} .cds--btn--${kind}`,
        ['open-save-view-dialog'],
        false,
        { width: { inside: '.cds--modal-container' } },
      ])
    );
    // No Delete-confirm row: that dialog is removed (A9).
    expect(PROBES.rows.filter((row) => row.selector.includes('delete'))).toEqual([]);
  });

  it('colours the screen header actions and their icons from the contract (B1)', () => {
    const action = '[data-testid=screen-header] .cds--header__action';
    const rows = PROBES.rows.filter((row) => row.selector.startsWith(action));
    expect(rows.map((row) => [row.app, row.selector, row.setup, row.expect])).toEqual([
      ['viewer', action, [], { color: { contract: 'text-secondary', hostOnly: true } }],
      ['viewer', `${action} svg`, [], { fill: { contract: 'text-secondary', hostOnly: true } }],
      ['viewer', action, ['hover'], { color: { contract: 'text-primary', hostOnly: true } }],
      [
        'viewer',
        `${action} svg`,
        ['hover'],
        { fill: { contract: 'text-primary', hostOnly: true } },
      ],
    ]);
    // Trace has no Carbon header any more (A39): the viewer's is the one the rule reaches.
    expect(
      PROBES.rows.filter((r) => r.app !== 'viewer' && r.selector.includes('header__action'))
    ).toEqual([]);
  });

  it('probes the Trace sidebar and panel density (B9)', () => {
    expect(rowsWhere('trace', '.wb-sidebar__header')[0].expect.height).toEqual({
      contract: 'control-h-xs',
    });
    expect(rowsWhere('trace', '#display-name').map((row) => row.expect)).toEqual([
      { height: { contract: 'control-h-sm' } },
    ]);
    expect(
      rowsWhere('trace', '.cds--toggle:has(#show-symbols) .cds--toggle__text').map(
        (row) => row.expect
      )
    ).toEqual([{ 'font-size': { contract: 'text-sm' } }]);
  });

  it('probes the workbench sidebar chrome with no setup', () => {
    for (const selector of ['.wb-split__edge', '.wb-sidebar__header']) {
      expect(
        rowsWhere('trace', selector).map((row) => row.setup),
        selector
      ).toEqual([[]]);
    }
  });
});

describe('host.json and host.css', () => {
  const ids = Object.keys(HOST.themes);

  it('describe three themes with valid ids, two dark and one light', () => {
    expect(ids).toEqual(['probe-a-dark', 'probe-b-dark', 'probe-light']);
    for (const id of ids) {
      expect(id).toMatch(HOST_THEME_ID);
      expect(HOST.themes[id].mode, id).toBe(modeFromThemeId(id));
    }
  });

  it('carry the contract version of tokens.json', () => {
    expect(HOST.contract).toBe(TOKENS.contract);
  });

  it('give every theme exactly the names of tokens.json', () => {
    for (const id of ids) expect(Object.keys(HOST.themes[id].values), id).toEqual(NAMES);
  });

  it('declare the same values in the stylesheet as in the JSON, with the marker first', () => {
    for (const id of ids) {
      const blocks = RULES.filter(([selector]) => selector === `[data-theme='${id}']`);
      expect(blocks.length, id).toBe(1);
      expect(blocks[0][1], id).toEqual([
        ['--canopy-host-contract', String(TOKENS.contract)],
        ...NAMES.map((name) => [`--canopy-host-${name}`, HOST.themes[id].values[name]]),
      ]);
    }
  });

  it('use values no Carbon zone uses, so a host value is told from a fallback', () => {
    for (const id of ids) {
      for (const name of NAMES) {
        const value = HOST.themes[id].values[name];
        expect(Object.values(TOKENS.names[name].literals), `${id} ${name}`).not.toContain(value);
      }
    }
  });

  it('give the probed values of theme A their documented shapes', () => {
    const a = HOST.themes['probe-a-dark'].values;
    expect(runner.normalizeFont(a['font-ui'])).toBe('probesans');
    expect(a['radius-sm']).toBe('7px');
    expect(a['accent']).toBe('#123456');
  });

  it('differ between the two dark themes in every name, so a same-mode flip shows', () => {
    const a = HOST.themes['probe-a-dark'].values;
    const b = HOST.themes['probe-b-dark'].values;
    expect(NAMES.filter((name) => a[name] === b[name])).toEqual([]);
  });

  it('set color-scheme under the selectors of a host that writes [data-theme="…"], quotes aside', () => {
    const schemes = RULES.filter(([, declarations]) =>
      declarations.some(([property]) => property === 'color-scheme')
    );
    expect(
      schemes.map(([selector, declarations]) => [selector.replaceAll('"', ''), declarations])
    ).toEqual([
      [':root, [data-theme=dark]', [['color-scheme', 'dark']]],
      ['[data-theme=light]', [['color-scheme', 'light']]],
    ]);
  });

  it('keep the double quotes of a host that writes [data-theme="…"] with double quotes', () => {
    expect(HOST_CSS).toContain(':root, [data-theme="dark"] {');
    expect(HOST_CSS).toContain('\n[data-theme="light"] {');
  });

  it('hold nothing but the two color-scheme rules and the three theme blocks', () => {
    expect(RULES.length).toBe(5);
  });
});

describe('links.html', () => {
  it('is one marked stylesheet link per line under the {prefix} placeholder', () => {
    const lines = LINKS.split('\n').filter((line) => line !== '');
    const hrefs = lines.map((line) => {
      const m =
        /^<link rel="stylesheet" data-canopy-host-sheet href="\{prefix\}\/([^"{}]+)">$/.exec(line);
      expect(m, line).not.toBeNull();
      return m?.[1];
    });
    expect(hrefs).toEqual([
      'design-system/css/tokens.css',
      'static/fonts/fonts.css',
      'design-system/css/canopy-host.css',
    ]);
  });
});

describe('setups.mjs', () => {
  it('exports exactly the setups a row may name, as functions', () => {
    const functions = Object.entries(setups)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);
    expect(functions.sort()).toEqual([...SETUP_NAMES].sort());
  });

  it('has postconditions only for setups it exports', () => {
    for (const name of Object.keys(setups.postconditions)) expect(SETUP_NAMES).toContain(name);
  });

  describe('the workbench setups', () => {
    /** A page whose DOM holds `present`; every click and wait is recorded in order. */
    function fakePage(present: string[]) {
      const log: string[] = [];
      const locator = (selector: string): unknown => ({
        first: () => locator(selector),
        count: async () => (present.includes(selector) ? 1 : 0),
        click: async () => void log.push(`click ${selector}`),
        hover: async () => void log.push(`hover ${selector}`),
        waitFor: async () => void log.push(`wait ${selector}`),
      });
      const page = { locator } as unknown as PageLike;
      return { page, log };
    }
    const run = (name: string, page: PageLike) =>
      (setups as unknown as Record<string, (p: PageLike, c: object) => Promise<void>>)[name](
        page,
        {}
      );
    const PANEL = '.wb-sidebar__pane--properties .wb-panel';
    const RAIL = '.wb-sidebar__rail-target[data-pane=properties]';

    it('open-properties expands a collapsed sidebar through the rail target, then waits', async () => {
      const railed = fakePage([RAIL]);
      await run('open-properties', railed.page);
      expect(railed.log).toEqual(['wait .wb-sidebar', `click ${RAIL}`, `wait ${PANEL}`]);

      // Showing already: nothing is clicked.
      const shown = fakePage([]);
      await run('open-properties', shown.page);
      expect(shown.log).toEqual(['wait .wb-sidebar', `wait ${PANEL}`]);
    });

    it('open-outline is open-properties: the panel holds both', async () => {
      const outline = fakePage([RAIL]);
      const properties = fakePage([RAIL]);
      await run('open-outline', outline.page);
      await run('open-properties', properties.page);
      expect(outline.log).toEqual(properties.log);
    });

    it('select-first-outline-row opens the first card unless one is open, then waits for its body', async () => {
      const name = `${PANEL} .wb-card__head .wb-outline-row__name`;
      const closed = fakePage([]);
      await run('select-first-outline-row', closed.page);
      expect(closed.log).toEqual([
        'wait .wb-sidebar',
        `wait ${PANEL}`,
        `click ${name}`,
        `wait ${PANEL} .wb-card--open .wb-card__body`,
      ]);

      // A card already open is left open: a second click would close it.
      const open = fakePage([`${PANEL} .wb-card--open`]);
      await run('select-first-outline-row', open.page);
      expect(open.log.filter((entry) => entry.startsWith('click'))).toEqual([]);
    });

    it('open-section-<id> opens the plot-wide section only when it is closed', async () => {
      const section = `${PANEL} .wb-plot-section[data-section=display]`;
      const head = `${section} > .wb-plot-section__head[aria-expanded=false]`;
      const closed = fakePage([head]);
      await run('open-section-display', closed.page);
      expect(closed.log).toEqual([
        'wait .wb-sidebar',
        `wait ${PANEL}`,
        `click ${head}`,
        `wait ${section} > .wb-plot-section__body`,
      ]);
      const open = fakePage([]);
      await run('open-section-axes', open.page);
      expect(open.log.filter((entry) => entry.startsWith('click'))).toEqual([]);
      expect(open.log.at(-1)).toBe(
        `wait ${PANEL} .wb-plot-section[data-section=axes] > .wb-plot-section__body`
      );
    });

    it('open-more opens the closed More disclosures it finds, then waits for one', async () => {
      const toggle = `${PANEL} .wb-block__more-toggle[aria-expanded=false]`;
      const { page, log } = fakePage([toggle]);
      await run('open-more', page);
      expect(log).toEqual([`click ${toggle}`, `wait ${PANEL} .wb-block__more-body`]);
    });

    it('open-save-view-dialog asks the stand-in Trace for a query only while Save is disabled', async () => {
      const log: string[] = [];
      let disabled = true;
      const locator = (selector: string): unknown => ({
        first: () => locator(selector),
        count: async () => 1,
        isDisabled: async () => disabled,
        click: async () => void log.push(`click ${selector}`),
        waitFor: async () => void log.push(`wait ${selector}`),
        evaluate: async (_fn: unknown, arg: unknown) => {
          log.push(`post ${selector} ${String(arg)}`);
          return null;
        },
      });
      const page = { locator } as unknown as PageLike;
      await run('open-save-view-dialog', page);
      expect(log).toEqual([
        'click .screen-tree [data-tool=trace]',
        'wait .save-view__button',
        `post iframe.workspace-trace ${setups.SAVE_VIEW_QUERY}`,
        'click .save-view__button',
        'wait .cds--modal.is-visible .cds--modal-container',
      ]);
      log.length = 0;
      disabled = false;
      await run('open-save-view-dialog', page);
      expect(log.filter((entry) => entry.startsWith('post'))).toEqual([]);
    });

    it('hover-action hovers the first action until its tooltip shows', async () => {
      const { page, log } = fakePage([]);
      await run('hover-action', page);
      expect(log).toEqual([
        'hover [data-testid=actions-bar] .cds--btn--icon-only',
        'wait [data-testid=actions-bar] .cds--popover-content',
      ]);
    });
  });
});

describe('runner.mjs', () => {
  it('exports the probe runner and nothing else', () => {
    expect(Object.keys(runner).sort()).toEqual([
      'ProbeFailure',
      'checkRow',
      'normalizeColor',
      'normalizeFont',
      'normalizeLength',
      'pageFor',
      'readHostValues',
      'runSetups',
      'zoneOf',
    ]);
    for (const name of ['zoneOf', 'checkRow', 'normalizeFont', 'normalizeColor'] as const) {
      expect(typeof runner[name], name).toBe('function');
    }
  });

  it('renders a page path for a theme id, the row page before the default', () => {
    expect(runner.pageFor(PROBES, { app: 'trace' }, 'probe-light')).toBe(
      '/?embedded=true&theme=probe-light&pv=SR:TEST&range=-10m'
    );
    expect(
      runner.pageFor(PROBES, { app: 'viewer', page: setups.WRITE_PROBE_PAGE }, 'probe-a-dark')
    ).toBe('/embed/drafts/write-probe?embedded=true&theme=probe-a-dark');
  });

  it('compares fonts by their first family, without quotes, spaces or case', () => {
    expect(runner.normalizeFont('"Probe Sans", sans-serif')).toBe('probesans');
    expect(runner.normalizeFont("'IBM Plex Mono', monospace")).toBe('ibmplexmono');
    expect(runner.normalizeFont('system-ui')).toBe('system-ui');
  });

  describe('in a document', () => {
    afterEach(() => {
      document.documentElement.removeAttribute('data-canopy-host');
      document.head.innerHTML = '';
      document.body.innerHTML = '';
    });

    /** A page whose locators resolve in this document, as far as the runner drives one. */
    function pageOf(doc: Document): PageLike {
      const locator = (selector: string) => {
        const all = () => [...doc.querySelectorAll(selector)];
        const self = {
          first: () => self,
          count: async () => all().length,
          evaluate: async (fn: (el: Element, arg: unknown) => unknown, arg: unknown) =>
            fn(all()[0], arg),
          isDisabled: async () => (all()[0] as HTMLButtonElement).disabled,
        };
        return self;
      };
      return { locator } as unknown as PageLike;
    }

    function mount(css: string, body: string): PageLike {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      document.body.innerHTML = body;
      return pageOf(document);
    }

    const row = (expectations: ProbeRow['expect'], more: Partial<ProbeRow> = {}): ProbeRow => ({
      app: 'viewer',
      selector: '.probed',
      setup: [],
      expect: expectations,
      ...more,
    });

    it('finds the nearest Carbon zone of an element', () => {
      mount(
        '',
        '<div class="cds--g10"><div class="cds--g100"><i class="in"></i></div><i class="out"></i></div><i class="none"></i>'
      );
      const zone = (selector: string) =>
        runner.zoneOf(document.querySelector(selector) as Element)?.className ?? null;
      expect(zone('.in')).toBe('cds--g100');
      expect(zone('.out')).toBe('cds--g10');
      expect(zone('.none')).toBeNull();
    });

    it('passes a literal that the element shows and fails one it does not', async () => {
      const page = mount(
        '.probed { border-left-width: 2px; }',
        '<div class="cds--white"><b class="probed"></b></div>'
      );
      const pass = await runner.checkRow(page, row({ 'border-left-width': { literal: '2px' } }));
      expect(pass.ok).toBe(true);
      expect(pass.zone).toBe('white');

      await expect(
        runner.checkRow(page, row({ 'border-left-width': { literal: '3px' } }))
      ).rejects.toBeInstanceOf(runner.ProbeFailure);

      const fail = await runner.checkRow(page, row({ 'border-left-width': { literal: '3px' } }), {
        throwOnFailure: false,
      });
      expect(fail.ok).toBe(false);
      expect(fail.failures).toEqual(['border-left-width is 2, expected 3 (the literal: 3px)']);
    });

    it('fails a row whose selector matches nothing, or matches outside every zone', async () => {
      const page = mount('', '<b class="probed"></b>');
      const options = { throwOnFailure: false };
      const outside = await runner.checkRow(page, row({ height: { literal: '1px' } }), options);
      expect(outside.failures).toEqual(['the element is inside no Carbon zone']);
      const missing = await runner.checkRow(
        page,
        row({ height: { literal: '1px' } }, { selector: '.absent' }),
        options
      );
      expect(missing.failures).toEqual(['the selector matches no element']);
    });

    it('fails a row when the document is not hosted as the caller expects', async () => {
      const page = mount(
        '.probed { border-left-width: 2px; }',
        '<div class="cds--white"><b class="probed"></b></div>'
      );
      const probe = row({ 'border-left-width': { literal: '2px' } });
      const fallen = await runner.checkRow(page, probe, { hosted: true, throwOnFailure: false });
      expect(fallen.failures).toEqual([
        'expected a hosted document, but <html> has no data-canopy-host',
      ]);
      document.documentElement.setAttribute('data-canopy-host', '');
      expect((await runner.checkRow(page, probe, { hosted: true })).ok).toBe(true);
      const hosted = await runner.checkRow(page, probe, { throwOnFailure: false });
      expect(hosted.failures).toEqual([
        'expected a standalone document, but <html> has data-canopy-host',
      ]);
    });

    it('skips a hostOnly target in a standalone document and checks it in a hosted one', async () => {
      const page = mount(
        '.probed { padding-top: 4px; }',
        '<div class="cds--white"><b class="probed"></b></div>'
      );
      const probe = row({ 'padding-top': { literal: '0px', hostOnly: true } });
      const standalone = await runner.checkRow(page, probe);
      expect(standalone.ok).toBe(true);
      expect(standalone.skipped).toEqual(['padding-top']);

      document.documentElement.setAttribute('data-canopy-host', '');
      const hosted = await runner.checkRow(page, probe, { hosted: true, throwOnFailure: false });
      expect(hosted.skipped).toEqual([]);
      expect(hosted.failures).toEqual(['padding-top is 4, expected 0 (the literal: 0px)']);
    });

    it('compares fill as a colour', async () => {
      const page = mount(
        '.probed { fill: #102030; }',
        '<div class="cds--white"><svg><rect class="probed"></rect></svg></div>'
      );
      expect((await runner.checkRow(page, row({ fill: { literal: '#102030' } }))).ok).toBe(true);
      const fail = await runner.checkRow(page, row({ fill: { literal: '#ffffff' } }), {
        throwOnFailure: false,
      });
      expect(fail.failures).toEqual([
        'fill is rgb(16, 32, 48), expected rgb(255, 255, 255) (the literal: #ffffff)',
      ]);
    });

    describe('an inside target', () => {
      /** Stubs the boxes jsdom does not lay out: the element's and each of its ancestors'. */
      function boxes(map: Record<string, [left: number, right: number]>) {
        for (const [selector, [left, right]] of Object.entries(map)) {
          const el = document.querySelector(selector) as Element;
          el.getBoundingClientRect = () =>
            ({ left, right, width: right - left, x: left, top: 0, bottom: 10 }) as DOMRect;
        }
      }
      const inside = row({ width: { inside: '.box' } });
      const html =
        '<div class="cds--white"><div class="box"><div class="foot"><b class="probed"></b></div></div></div>';

      it('passes when both inline edges lie within the ancestor', async () => {
        const page = mount('', html);
        boxes({ '.box': [100, 500], '.probed': [100.4, 499.6] });
        const result = await runner.checkRow(page, inside);
        expect(result.ok).toBe(true);
        expect(result.checks[0].comparisons.map((c) => c.against)).toEqual([
          'the inline edges of .box',
        ]);
      });

      it('fails an element that starts left of the ancestor, as Cancel did (A2)', async () => {
        const page = mount('', html);
        boxes({ '.box': [100, 500], '.probed': [-197, 60] });
        const result = await runner.checkRow(page, inside, { throwOnFailure: false });
        expect(result.failures).toEqual([
          'the box is -197..60, expected within 100..500 (the inline edges of .box)',
        ]);
      });

      it('fails an element past the right edge, an empty box, or one with no such ancestor', async () => {
        const page = mount('', html);
        const options = { throwOnFailure: false };
        boxes({ '.box': [100, 500], '.probed': [400, 501] });
        expect((await runner.checkRow(page, inside, options)).ok).toBe(false);
        boxes({ '.probed': [200, 200] });
        expect((await runner.checkRow(page, inside, options)).ok).toBe(false);
        const orphan = await runner.checkRow(page, row({ width: { inside: '.absent' } }), options);
        expect(orphan.failures).toEqual([
          'the box is 200..200, expected within .absent (no ancestor matches .absent)',
        ]);
      });

      it('never takes the element itself for its ancestor', async () => {
        const page = mount('', '<div class="cds--white"><b class="probed box"></b></div>');
        boxes({ '.probed': [0, 10] });
        const result = await runner.checkRow(page, inside, { throwOnFailure: false });
        expect(result.ok).toBe(false);
      });

      it('checks the geometry standalone and hosted alike', async () => {
        const page = mount('', html);
        boxes({ '.box': [100, 500], '.probed': [150, 450] });
        document.documentElement.setAttribute('data-canopy-host', '');
        const hosted = await runner.checkRow(page, inside, { hosted: true });
        expect([hosted.ok, hosted.skipped]).toEqual([true, []]);
      });
    });

    it('runs the postconditions of the row setups last', async () => {
      // A stand-in postcondition, so the runner is pinned apart from any one setup's hold.
      const page = mount(
        '.probed { border-left-width: 2px; }',
        '<div class="cds--white"><b class="probed" data-held="true"></b></div>'
      );
      const posts = setups.postconditions as Record<string, (page: PageLike) => Promise<void>>;
      const order: string[] = [];
      posts.focus = async (p) => {
        order.push('post');
        if ((await p.locator('.probed[data-held=true]').count()) === 0) {
          throw new Error('focus: the hold ended; the row was read too late');
        }
      };
      try {
        const probe = row({ 'border-left-width': { literal: '2px' } }, { setup: ['focus'] });
        const held = await runner.checkRow(page, probe);
        expect(held.ok).toBe(true);
        expect(order).toEqual(['post']);

        document.querySelector('.probed')?.removeAttribute('data-held');
        const late = await runner.checkRow(page, probe, { throwOnFailure: false });
        expect(late.failures).toEqual(['focus: the hold ended; the row was read too late']);
      } finally {
        delete posts.focus;
      }
    });

    it('fails a drop-highlight row that is read while no drag is held', async () => {
      const page = mount(
        '.probed { border-left-width: 2px; }',
        '<div class="cds--white"><div class="tab-strip"></div><b class="probed"></b></div>'
      );
      const probe = row({ 'border-left-width': { literal: '2px' } }, { setup: ['hold-tab-drag'] });
      const loose = await runner.checkRow(page, probe, { throwOnFailure: false });
      expect(loose.failures).toEqual(['hold-tab-drag: no drag is held']);
    });

    it('fails the drag setup where there is no second tile to hold it over', async () => {
      const page = mount(
        '',
        '<div class="cds--white">' +
          '<div data-testid="workspace-dock" data-docked=\'["a","b"]\'></div>' +
          '<div class="tab-strip"><div role="tab" data-docked="true" data-tab-key="a"></div></div>' +
          '<div data-testid="tile-bar" data-panel-key="a"></div></div>'
      );
      const waited: string[] = [];
      const withWait: PageLike = {
        ...page,
        locator: (selector: string) => {
          const found = page.locator(selector);
          const self = {
            ...found,
            first: () => self,
            waitFor: async () => {
              waited.push(selector);
            },
          };
          return self as unknown as ReturnType<PageLike['locator']>;
        },
      };
      await expect(
        runner.runSetups(withWait, { selector: '.probed', setup: ['hold-tab-drag'] })
      ).rejects.toThrow('hold-tab-drag: no second tile to hold the drag over');
      expect(waited).toEqual([`[data-testid=workspace-dock][data-docked*='","']`]);
    });
  });
});
