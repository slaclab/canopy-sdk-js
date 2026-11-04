// The hand-written component rules of `host-contract.css` (everything outside the generated
// markers), read as text: structure only. What the rules compute to in a browser is asserted by
// the Playwright suites of the apps that load the sheet.

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
  names: Record<string, { drives: string[] }>;
}
type Declarations = Record<string, string>;

const START = '/* @generated blocks start */';
const END = '/* @generated blocks end */';
const GATE = 'html[data-canopy-host]';

const TOKENS = JSON.parse(read('tokens.json')) as Tokens;
const SHEET = read('host-contract.css');
const NAMES = Object.keys(TOKENS.names);
/**
 * The tile-bar names: canopy-screen-runtime's tile bar reads them, this sheet has no component
 * they style, so I-1's consumer rule does not apply to them.
 */
const TILE_BAR_NAMES = [
  'bar-h',
  'bar-icon',
  'tab-min-w',
  'tab-max-w',
  'tab-underline',
  'weight-medium',
  'shadow-dropdown',
  'z-dropdown',
];

/** Everything outside the two markers, comments included. */
function handWritten(sheet: string): string {
  const start = sheet.indexOf(START);
  const end = sheet.indexOf(END);
  if (start === -1 || end < start) throw new Error('host-contract.css has no generated blocks');
  return sheet.slice(0, start) + sheet.slice(end + END.length);
}

const HAND = handWritten(SHEET);
const HAND_CSS = HAND.replace(/\/\*[\s\S]*?\*\//g, '');

/** Each selector of the hand-written section → the declarations of every rule that lists it. */
function selectorDeclarations(css: string): Map<string, Declarations> {
  const bySelector = new Map<string, Declarations>();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = [...body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map(
      ([, property, value]) => [property, value.trim().replace(/\s+/g, ' ')] as const
    );
    for (const selector of selectors.split(',')) {
      const key = selector.trim().replace(/\s+/g, ' ').replace(/"/g, "'");
      const merged = bySelector.get(key) ?? {};
      for (const [property, value] of declarations) {
        if (property in merged) throw new Error(`${key} declares ${property} twice`);
        merged[property] = value;
      }
      bySelector.set(key, merged);
    }
  }
  return bySelector;
}

const RULES = selectorDeclarations(HAND_CSS);
const hosted = (selector: string) => `${GATE} ${selector}`;

function rule(selector: string): Declarations {
  const found = RULES.get(selector);
  if (found === undefined) throw new Error(`the hand-written section has no rule for ${selector}`);
  return found;
}

/** Outranks Carbon's (0,4,1) icon fill on a hovered, pressed or open header action. */
const HEADER_ICON = '.cds--header .cds--btn.cds--header__action svg';

const v = (name: string) => `var(--canopy-${name})`;
const ALPHA_ACCENT = `color-mix(in srgb, ${v('accent')} 25%, transparent)`;

/** The ungated classes an app opts into; everything else applies under the host gate only. */
const RECIPES = ['.canopy-btn', '.canopy-row', '.canopy-section-heading'];

const DANGER_READERS = [
  '.cds--btn--danger',
  '.cds--btn--danger:hover',
  '.cds--btn--danger:focus',
  '.cds--btn--danger:active',
  '.cds--menu-item--danger:hover',
  '.cds--menu-item--danger:focus',
  '.cds--overflow-menu-options__option--danger .cds--overflow-menu-options__btn:hover',
  '.cds--overflow-menu-options__option--danger .cds--overflow-menu-options__btn:focus',
];

describe('the hand-written section of host-contract.css', () => {
  it('follows the generated blocks and leaves their markers alone', () => {
    expect(SHEET.split(START)).toHaveLength(2);
    expect(SHEET.split(END)).toHaveLength(2);
    expect(SHEET.startsWith(START)).toBe(true);
    expect(RULES.size).toBeGreaterThan(0);
  });

  it('contains exactly one hex literal, #ffffff, comments included', () => {
    expect(HAND.match(/#[0-9a-fA-F]{3,8}\b/g)).toEqual(['#ffffff']);
  });

  it('names no other colour: no rgb(), hsl() or colour keyword besides transparent', () => {
    expect(HAND_CSS).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/);
    expect(HAND_CSS).not.toMatch(/:\s*(white|black|red)\b/i);
  });

  it('reads currentColor once, as the fill of a header-action icon', () => {
    expect(HAND_CSS.match(/currentcolor/gi)).toHaveLength(1);
    const readers = [...RULES].filter(([, d]) =>
      Object.values(d).some((x) => /currentcolor/i.test(x))
    );
    expect(readers).toEqual([[hosted(HEADER_ICON), { fill: 'currentColor' }]]);
  });

  it('reads contract variables only, and only names of the contract', () => {
    const read = [...HAND_CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(([, name]) => name);
    expect(read.length).toBeGreaterThan(0);
    for (const name of read) {
      expect(name.startsWith('--canopy-host-'), name).toBe(false);
      expect(NAMES, name).toContain(name.replace(/^--canopy-/, ''));
    }
  });

  it('declares one custom property, the layout height of a header action', () => {
    const declared = [...HAND_CSS.matchAll(/(?:^|[{;\s])(--[a-z0-9-]+)\s*:/g)].map(([, n]) => n);
    expect(declared).toEqual(['--cds-layout-size-height-local']);
    expect(HAND_CSS.match(/--cds-/g)).toHaveLength(1);
  });

  it('gates every rule except the three recipes', () => {
    for (const selector of RULES.keys()) {
      if (RECIPES.some((recipe) => selector.startsWith(recipe))) continue;
      expect(selector.startsWith(`${GATE} `), selector).toBe(true);
    }
  });

  it('defines no recipe besides .canopy-btn, .canopy-row and .canopy-section-heading', () => {
    const ungated = [...RULES.keys()].filter((selector) => !selector.startsWith(`${GATE} `));
    expect(ungated.sort()).toEqual(
      [
        '.canopy-btn',
        '.canopy-btn:hover',
        ".canopy-btn[aria-pressed='true']",
        '.canopy-btn:focus-visible',
        '.canopy-row',
        '.canopy-row__label',
        '.canopy-row__meta',
        '.canopy-row__icon',
        '.canopy-section-heading',
      ].sort()
    );
  });

  it('ships no fonts and no at-rules', () => {
    expect(HAND_CSS).not.toContain('@');
  });
});

describe('the .canopy-btn recipe', () => {
  it('is a ghost button sized by the contract', () => {
    expect(rule('.canopy-btn')).toEqual({
      'block-size': v('control-h-sm'),
      'min-inline-size': v('control-h-sm'),
      padding: '0 8px',
      border: '1px solid transparent',
      'border-radius': v('radius-sm'),
      background: 'transparent',
      color: v('text-secondary'),
      font: 'inherit',
      cursor: 'pointer',
    });
  });

  it('hovers and presses with an alpha accent border, never the solid accent', () => {
    expect(rule('.canopy-btn:hover')).toEqual({
      color: v('accent-hover'),
      'border-color': ALPHA_ACCENT,
      background: v('bg-elevated'),
    });
    expect(rule(".canopy-btn[aria-pressed='true']")).toEqual({ 'border-color': ALPHA_ACCENT });
  });

  it('shows the contract focus ring', () => {
    expect(rule('.canopy-btn:focus-visible')).toEqual({
      outline: `2px solid ${v('focus')}`,
      'outline-offset': '-2px',
    });
  });
});

describe('the .canopy-row recipe', () => {
  it('is a single-line row at the tree height, in text-md with a unitless line-height', () => {
    expect(rule('.canopy-row')).toEqual({
      display: 'flex',
      'align-items': 'center',
      gap: '4px',
      'box-sizing': 'border-box',
      'block-size': v('control-h-xs'),
      'font-size': v('text-md'),
      'line-height': '1.25',
      color: v('text-primary'),
    });
  });

  it('truncates its label instead of wrapping or growing the row', () => {
    expect(rule('.canopy-row__label')).toEqual({
      flex: '1 1 auto',
      'min-inline-size': '0',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap',
    });
  });

  it('sets its meta in text-sm and the muted text colour', () => {
    expect(rule('.canopy-row__meta')).toEqual({
      flex: '0 0 auto',
      'font-size': v('text-sm'),
      'line-height': '1.25',
      color: v('text-muted'),
    });
  });

  it('keeps its icon at its own size in the secondary text colour', () => {
    expect(rule('.canopy-row__icon')).toEqual({
      flex: '0 0 auto',
      display: 'inline-flex',
      'align-items': 'center',
      color: v('text-secondary'),
    });
  });
});

describe('the .canopy-section-heading recipe', () => {
  it('is a text-sm heading with a unitless line-height and no margin', () => {
    expect(rule('.canopy-section-heading')).toEqual({
      margin: '0',
      'font-size': v('text-sm'),
      'font-weight': '600',
      'line-height': '1.25',
      color: v('text-secondary'),
    });
  });
});

describe('the recipes read existing contract names only', () => {
  it.each(RECIPES)('%s reads only names of tokens.json', (recipe) => {
    const recipeRules = [...RULES].filter(([selector]) => selector.startsWith(recipe));
    expect(recipeRules.length).toBeGreaterThan(0);
    for (const [, declarations] of recipeRules) {
      for (const value of Object.values(declarations)) {
        for (const [, name] of value.matchAll(/var\(\s*--canopy-([a-z0-9-]+)/g)) {
          expect(NAMES, name).toContain(name);
        }
      }
    }
  });

  it('keeps the contract at 35 names', () => {
    expect(NAMES).toHaveLength(35);
  });
});

describe('the component rules under the host gate', () => {
  it('make the anchor opaque, viewport-filling and in font-ui', () => {
    expect(rule(hosted('[data-canopy-host-root]'))).toEqual({
      'font-family': v('font-ui'),
      'min-height': '100%',
      background: v('bg-base'),
    });
  });

  it('set code in font-mono, number inputs and the content switcher in font-ui', () => {
    expect(rule(hosted('code'))['font-family']).toBe(v('font-mono'));
    expect(rule(hosted('.cds--number input'))['font-family']).toBe(v('font-ui'));
    expect(rule(hosted('.cds--content-switcher-btn'))['font-family']).toBe(v('font-ui'));
  });

  it.each(['.cds--modal-container', '.cds--menu', '.cds--overflow-menu-options'])(
    'put %s on the elevated surface',
    (selector) => {
      expect(rule(hosted(selector)).background).toBe(v('bg-elevated'));
    }
  );

  it('paint the selected ContentSwitcher pill and its text', () => {
    const selected = '.cds--content-switcher-btn.cds--content-switcher--selected';
    expect(rule(hosted(`${selected}::after`))).toEqual({ 'background-color': v('accent') });
    expect(rule(hosted(selected))).toEqual({ color: v('on-accent') });
  });

  it.each([':hover', ':focus', ':active'])('label a tertiary button%s in on-accent', (state) => {
    expect(rule(hosted(`.cds--btn--tertiary${state}`))).toEqual({ color: v('on-accent') });
  });

  it.each(['', ':hover', ':focus'])('label a secondary button%s in text-primary', (state) => {
    expect(rule(hosted(`.cds--btn--secondary${state}`)).color).toBe(v('text-primary'));
  });

  it.each(DANGER_READERS)('keep %s white over the Carbon red', (selector) => {
    expect(rule(hosted(selector)).color).toBe('#ffffff');
  });

  it('use the colour literal for the danger pair and nowhere else', () => {
    const literal = [...RULES].filter(([, d]) => Object.values(d).some((x) => x.includes('#')));
    expect(literal.map(([selector]) => selector).sort()).toEqual(DANGER_READERS.map(hosted).sort());
  });

  it.each([
    '.cds--btn',
    '.cds--text-input',
    '.cds--select-input',
    '.cds--search-input',
    '.cds--tabs__nav-link',
  ])('round %s with radius-sm', (selector) => {
    expect(rule(hosted(selector))['border-radius']).toBe(v('radius-sm'));
  });

  it('round the modal container with radius-md', () => {
    expect(rule(hosted('.cds--modal-container'))['border-radius']).toBe(v('radius-md'));
  });

  it('size the header, its name and its actions', () => {
    expect(rule(hosted('.cds--header'))).toEqual({
      'block-size': v('control-h-sm'),
      background: v('bg-panel'),
      'border-bottom': `1px solid ${v('border')}`,
    });
    expect(rule(hosted('.cds--header__name'))).toEqual({
      'padding-inline': '0 8px',
      'font-size': v('text-lg'),
      color: v('text-primary'),
    });
    expect(rule(hosted('.cds--header__action svg'))).toEqual({
      'inline-size': '16px',
      'block-size': '16px',
    });
  });

  it('size a header action through the layout variable plus explicit sizes', () => {
    expect(rule(hosted('.cds--header__action'))).toEqual({
      '--cds-layout-size-height-local': v('control-h-sm'),
      'block-size': v('control-h-sm'),
      'inline-size': v('control-h-sm'),
      'min-inline-size': v('control-h-sm'),
      color: v('text-secondary'),
    });
  });

  it('colour a header action from the contract in every state (B1)', () => {
    expect(rule(hosted('.cds--header__action:hover'))).toEqual({
      color: v('text-primary'),
      'background-color': v('hover-tint'),
    });
    expect(rule(hosted('.cds--header__action:focus'))).toEqual({
      'border-color': v('focus'),
      'box-shadow': `inset 0 0 0 1px ${v('focus')}`,
    });
    expect(rule(hosted(HEADER_ICON))).toEqual({ fill: 'currentColor' });
  });

  // Carbon pins the input at (0,2,1) with attribute selectors, in both sizes.
  it.each([
    ".cds--number input[type='number']",
    ".cds--number input[type='text']",
    ".cds--number--sm input[type='number']",
    ".cds--number--sm input[type='text']",
  ])('give %s the contract control height', (selector) => {
    expect(rule(hosted(selector))['block-size']).toBe(v('control-h-sm'));
  });

  it('lay out the modal footer for compact buttons', () => {
    expect(rule(hosted('.cds--modal-footer'))).toEqual({
      'block-size': 'auto',
      padding: '8px 12px',
      gap: '8px',
      'justify-content': 'flex-end',
    });
  });

  // The :not(.cds--skeleton) selector is what outranks Carbon's (0,3,0) footer padding. Carbon's
  // `.cds--btn-set .cds--btn { inline-size: 100% }` would otherwise push Cancel off-screen (A2).
  it.each(['.cds--modal-footer .cds--btn', '.cds--modal-footer .cds--btn:not(.cds--skeleton)'])(
    'fit %s inside a contract-height box',
    (selector) => {
      expect(rule(hosted(selector))).toMatchObject({
        flex: '0 0 auto',
        'align-items': 'center',
        'block-size': v('control-h-sm'),
        'min-block-size': v('control-h-sm'),
        'padding-block': '0',
        'padding-inline': '12px',
        'inline-size': 'auto',
        'max-inline-size': 'none',
      });
    }
  );
});

describe('I-1: every contract name has a consumer in the sheet', () => {
  const css = SHEET.replace(/\/\*[\s\S]*?\*\//g, '');

  it('has 35 names', () => {
    expect(NAMES).toHaveLength(35);
  });

  it.each(NAMES.filter((name) => !TILE_BAR_NAMES.includes(name)))(
    '--canopy-%s is read by a declaration',
    (name) => {
      expect(css).toMatch(new RegExp(`var\\(\\s*--canopy-${name}\\s*[,)]`));
    }
  );

  it.each(TILE_BAR_NAMES)('--canopy-%s is left to the runtime tile bar, unread here', (name) => {
    expect(NAMES).toContain(name);
    expect(TOKENS.names[name].drives).toEqual([]);
    expect(css).not.toMatch(new RegExp(`var\\(\\s*--canopy-${name}\\s*[,)]`));
  });

  it.each(['font-ui', 'radius-sm', 'radius-md'])(
    '--canopy-%s, which drives no Carbon token, is read by a component rule',
    (name) => {
      expect(TOKENS.names[name].drives).toEqual([]);
      expect(HAND_CSS).toContain(v(name));
    }
  );
});
