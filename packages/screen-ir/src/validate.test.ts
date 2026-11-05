import { describe, expect, it } from 'vitest';
import { validate } from './validate.js';
import { SCHEMA_VERSION, MACRO_NAME_PATTERN } from './index.js';

const minimal = {
  schemaVersion: SCHEMA_VERSION,
  kind: 'screen',
  id: 's',
  metadata: { title: 'S', source: { type: 'hand-authored' }, size: { width: 100, height: 100 } },
  macros: [] as unknown[],
  root: {
    id: 'w-001',
    type: 'absolute-canvas',
    props: { width: 100, height: 100 },
    geometry: { x: 0, y: 0, width: 100, height: 100 },
  },
};

describe('@slaclab/canopy-screen-ir validate', () => {
  it('accepts a minimal valid screen', () => {
    expect(validate(minimal)).toEqual([]);
  });

  it('accepts lowercase/mixed-case macro names (canonical ^[A-Za-z] pattern)', () => {
    const screen = {
      ...minimal,
      macros: [
        { name: 'dev', default: '' },
        { name: 'signal', default: '' },
        { name: 'PREFIX', default: '' },
      ],
    };
    expect(validate(screen)).toEqual([]);
    expect(MACRO_NAME_PATTERN.test('dev')).toBe(true);
    expect(MACRO_NAME_PATTERN.test('PREFIX')).toBe(true);
    expect(MACRO_NAME_PATTERN.test('1bad')).toBe(false);
  });

  it('flags a macro name starting with a digit', () => {
    const screen = { ...minimal, macros: [{ name: '1BAD', default: '' }] };
    expect(validate(screen).length).toBeGreaterThan(0);
  });

  describe('rule positions', () => {
    const role = { $role: 'alarm.major', fallback: '#ff0000', fallbackDark: '#ff4040' };

    const withConditional = (value: unknown, dflt: unknown = '#000000') => ({
      ...minimal,
      root: {
        ...minimal.root,
        rules: [
          {
            id: 'r1',
            name: 'Color',
            targetProperty: 'foreground',
            default: dflt,
            pvs: [{ name: 'SIM:PV', trigger: true }],
            conditions: [{ expression: '{0} > 1', value }],
          },
        ],
      },
    });

    const withFormula = (dflt: unknown) => ({
      ...minimal,
      formulas: [{ name: 'f', expression: '1' }],
      root: {
        ...minimal.root,
        rules: [
          { id: 'r1', name: 'Color', targetProperty: 'foreground', default: dflt, formula: 'f' },
        ],
      },
    });

    it.each([
      ['string', '#00ff00'],
      ['number', 3],
      ['boolean', true],
      ['null', null],
    ])('still accepts a %s condition value', (_label, v) => {
      expect(validate(withConditional(v))).toEqual([]);
    });

    it('accepts a role in a condition value', () => {
      expect(validate(withConditional(role))).toEqual([]);
    });

    it('accepts a role as a conditional-arm default', () => {
      expect(validate(withConditional('#00ff00', role))).toEqual([]);
    });

    it('accepts a role without fallbackDark', () => {
      expect(validate(withConditional({ $role: 'ok', fallback: '#00ff0080' }))).toEqual([]);
    });

    it('accepts a scalar formula-arm default', () => {
      expect(validate(withFormula('#000000'))).toEqual([]);
    });

    it.each([
      ['a 65-character role', { $role: 'r'.repeat(65), fallback: '#000000' }],
      ['an empty role', { $role: '', fallback: '#000000' }],
      ['a #ff fallback', { $role: 'x', fallback: '#ff' }],
      ['a #ff fallbackDark', { $role: 'x', fallback: '#000000', fallbackDark: '#ff' }],
      ['an extra key', { $role: 'x', fallback: '#000000', extra: 1 }],
      ['a missing fallback', { $role: 'x' }],
    ])('rejects %s in a condition value', (_label, v) => {
      expect(validate(withConditional(v)).length).toBeGreaterThan(0);
    });

    it('rejects a bad role as a conditional-arm default', () => {
      expect(
        validate(withConditional('#00ff00', { $role: 'x', fallback: '#ff' })).length
      ).toBeGreaterThan(0);
    });

    it('rejects a role as a formula-arm default', () => {
      expect(validate(withFormula(role)).length).toBeGreaterThan(0);
    });
  });

  describe('property positions', () => {
    const role = { $role: 'Text', fallback: '#161616', fallbackDark: '#f4f4f4' };

    const withProps = (props: unknown) => ({ ...minimal, root: { ...minimal.root, props } });
    const withChildProps = (props: unknown) => ({
      ...minimal,
      root: {
        ...minimal.root,
        children: [{ id: 'c', type: 'text-label', props, geometry: minimal.root.geometry }],
      },
    });

    it.each([
      ['a top-level prop', { foregroundColor: role }],
      ['a role without fallbackDark', { foregroundColor: { $role: 'x', fallback: '#000000' } }],
      ['curves[].color', { curves: [{ color: role, pv: 'A' }, { color: '#ff0000' }] }],
      ['a nested object', { style: { line: { color: role } } }],
    ])('accepts a role in %s', (_label, props) => {
      expect(validate(withProps(props))).toEqual([]);
      expect(validate(withChildProps(props))).toEqual([]);
    });

    it('accepts role-free literals at any depth', () => {
      const props = { a: 1, b: null, c: [1, 'x', [true]], d: { e: { f: [] } } };
      expect(validate(withProps(props))).toEqual([]);
    });

    it.each([
      ['a named-color fallback', { $role: 'Text', fallback: 'black' }],
      ['a missing fallback', { $role: 'Text' }],
      ['an extra key', { $role: 'Text', fallback: '#000000', extra: 1 }],
      ['a non-string role', { $role: 7, fallback: '#000000' }],
      ['a #ff fallbackDark', { $role: 'x', fallback: '#000000', fallbackDark: '#ff' }],
    ])('rejects %s in a prop, in curves[].color and in a nested object', (_label, bad) => {
      expect(validate(withProps({ foregroundColor: bad })).length).toBeGreaterThan(0);
      expect(validate(withChildProps({ foregroundColor: bad })).length).toBeGreaterThan(0);
      expect(validate(withProps({ curves: [{ color: bad }] })).length).toBeGreaterThan(0);
      expect(validate(withProps({ style: { line: { color: bad } } })).length).toBeGreaterThan(0);
    });

    it('names the property and the reason, once', () => {
      expect(
        validate(withProps({ foregroundColor: { $role: 'Text', fallback: 'black' } }))
      ).toEqual([
        '/root/props/foregroundColor/fallback must match pattern "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"',
      ]);
      expect(
        validate(withProps({ curves: [{ color: { $role: 'x', fallback: '#000000', extra: 1 } }] }))
      ).toEqual(['/root/props/curves/0/color must NOT have additional properties']);
    });
  });

  describe('documented props: hoverLabel, outlineColor, outlineWidth', () => {
    const withProps = (props: unknown) => ({ ...minimal, root: { ...minimal.root, props } });

    it('accepts a hover label, a CSS or role outline color and an outline width', () => {
      expect(validate(withProps({ hoverLabel: 'Open Booster →' }))).toEqual([]);
      expect(validate(withProps({ hoverLabelPlacement: 'center' }))).toEqual([]);
      expect(validate(withProps({ outlineColor: '#24a148', outlineWidth: 3 }))).toEqual([]);
      expect(
        validate(withProps({ outlineColor: { $role: 'OK', fallback: '#24a148' }, outlineWidth: 0 }))
      ).toEqual([]);
    });

    it('rejects ill-typed values', () => {
      expect(validate(withProps({ hoverLabel: 5 }))).toEqual([
        '/root/props/hoverLabel must be string',
      ]);
      expect(validate(withProps({ outlineWidth: -1 }))).toEqual([
        '/root/props/outlineWidth must be >= 0',
      ]);
      expect(validate(withProps({ outlineColor: 7 })).length).toBeGreaterThan(0);
      expect(validate(withProps({ hoverLabelPlacement: 'middle' })).length).toBeGreaterThan(0);
    });
  });
});

describe('@slaclab/canopy-screen-ir validate: formula references', () => {
  const rule = { id: 'r-001', name: 'R', targetProperty: 'visible', default: false };
  const pvRule = (name: string) => ({
    ...rule,
    pvs: [{ name, trigger: true }],
    conditions: [{ expression: '{0} > 1', value: true }],
  });

  /** A screen declaring formula `sum`, with one child widget under the root. */
  const screenWith = (child: { props?: object; rules?: object[] }) => ({
    ...minimal,
    formulas: [{ name: 'sum', expression: 'A + B', bindings: { A: 'sim://a', B: 'sim://b' } }],
    root: {
      ...minimal.root,
      children: [
        { id: 'w-002', type: 'text-update', props: {}, geometry: minimal.root.geometry, ...child },
      ],
    },
  });

  it('accepts a declared formula:// reference in a widget prop', () => {
    expect(validate(screenWith({ props: { channel: 'formula://sum' } }))).toEqual([]);
  });

  it('flags an undeclared formula:// reference in a widget prop', () => {
    expect(validate(screenWith({ props: { channel: 'formula://missing' } }))).toEqual([
      "widget 'w-002' prop 'channel' references formula 'missing' but no formulas[] entry declares it",
    ]);
  });

  it('accepts a declared formula:// reference in a rule PV binding', () => {
    expect(validate(screenWith({ rules: [pvRule('formula://sum')] }))).toEqual([]);
  });

  it('flags an undeclared formula:// reference in a rule PV binding', () => {
    expect(validate(screenWith({ rules: [pvRule('formula://missing')] }))).toEqual([
      "rule 'r-001' on widget 'w-002' pv references formula 'missing' but no formulas[] entry declares it",
    ]);
  });

  it('resolves a bare-name Rule.formula against formulas[]', () => {
    expect(validate(screenWith({ rules: [{ ...rule, formula: 'sum' }] }))).toEqual([]);
  });

  it('flags an undeclared bare-name Rule.formula', () => {
    expect(validate(screenWith({ rules: [{ ...rule, formula: 'missing' }] }))).toEqual([
      "rule 'r-001' on widget 'w-002' references formula 'missing' but no formulas[] entry declares it",
    ]);
  });
});
