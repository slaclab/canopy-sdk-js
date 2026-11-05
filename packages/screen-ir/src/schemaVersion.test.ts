import { describe, expect, it } from 'vitest';
import schema from '../spec/screen-ir/screen-ir.schema.json' with { type: 'json' };
import {
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  isSupportedSchemaVersion,
  stampSchemaVersion,
  validate,
} from './index.js';

const role = { $role: 'alarm.major', fallback: '#ff0000', fallbackDark: '#ff4040' };

const minimal = {
  schemaVersion: SCHEMA_VERSION,
  kind: 'screen',
  id: 's',
  metadata: { title: 'S', source: { type: 'hand-authored' }, size: { width: 100, height: 100 } },
  macros: [] as unknown[],
  root: {
    id: 'w-001',
    type: 'absolute-canvas',
    props: { width: 100, height: 100 } as Record<string, unknown>,
    geometry: { x: 0, y: 0, width: 100, height: 100 },
  },
};

const withRootProps = (props: Record<string, unknown>) => ({
  ...minimal,
  root: { ...minimal.root, props: { ...minimal.root.props, ...props } },
});

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

const withChild = (child: Record<string, unknown>) => ({
  ...minimal,
  root: {
    ...minimal.root,
    children: [
      {
        id: 'w-002',
        type: 'label',
        props: {},
        geometry: { x: 0, y: 0, width: 10, height: 10 },
        ...child,
      },
    ],
  },
});

describe('schema version set', () => {
  it('keeps SCHEMA_VERSION at 1.0 for existing importers', () => {
    expect(SCHEMA_VERSION).toBe('1.0');
  });

  it('supports exactly 1.0 and 1.1', () => {
    expect([...SUPPORTED_SCHEMA_VERSIONS]).toEqual(['1.0', '1.1']);
  });

  it.each([
    ['1.0', true],
    ['1.1', true],
    ['1.2', false],
    ['2.0', false],
    ['', false],
    [1.1, false],
    [null, false],
    [undefined, false],
  ])('isSupportedSchemaVersion(%j) is %s', (v, expected) => {
    expect(isSupportedSchemaVersion(v)).toBe(expected);
  });

  it('schema $id names version 1.1', () => {
    expect(schema.$id).toBe('urn:canopy:screen-ir:1.1');
  });

  it('schema schemaVersion is the enum 1.0|1.1', () => {
    expect(schema.properties.schemaVersion).toEqual({ enum: ['1.0', '1.1'] });
  });
});

describe('validate() version gate', () => {
  it.each(['1.0', '1.1'])('accepts schemaVersion %s', (v) => {
    expect(validate({ ...minimal, schemaVersion: v })).toEqual([]);
  });

  it.each(['1.2', '0.9', '2.0', ''])('rejects schemaVersion %j', (v) => {
    expect(validate({ ...minimal, schemaVersion: v }).length).toBeGreaterThan(0);
  });

  it('rejects a missing schemaVersion', () => {
    const { schemaVersion: _omit, ...rest } = minimal;
    void _omit;
    expect(validate(rest).length).toBeGreaterThan(0);
  });

  it('accepts a role-bearing doc stamped 1.1', () => {
    const doc = withConditional(role, role);
    expect(validate({ ...doc, schemaVersion: stampSchemaVersion(doc) })).toEqual([]);
  });
});

describe('stampSchemaVersion', () => {
  it('stamps a role-free doc 1.0', () => {
    expect(stampSchemaVersion(minimal)).toBe('1.0');
  });

  it('stamps a doc with role-free rules and nested arrays 1.0', () => {
    const doc = withChild({
      props: { curves: [{ channel: 'SIM:PV', color: '#00ff00' }], text: '$role' },
      rules: [
        {
          id: 'r1',
          name: 'Color',
          targetProperty: 'foreground',
          default: '#000000',
          pvs: [{ name: 'SIM:PV', trigger: true }],
          conditions: [{ expression: '{0} > 1', value: '#ff0000' }],
        },
      ],
    });
    expect(stampSchemaVersion(doc)).toBe('1.0');
  });

  it('stamps 1.1 for a role in a top-level prop', () => {
    expect(stampSchemaVersion(withRootProps({ foreground: role }))).toBe('1.1');
  });

  it('stamps 1.1 for a role in a rule condition value', () => {
    expect(stampSchemaVersion(withConditional(role))).toBe('1.1');
  });

  it('stamps 1.1 for a role in a rule default', () => {
    expect(stampSchemaVersion(withConditional('#00ff00', role))).toBe('1.1');
  });

  it('stamps 1.1 for a role in curves[].color', () => {
    const doc = withRootProps({
      curves: [
        { channel: 'SIM:A', color: '#00ff00' },
        { channel: 'SIM:B', color: { $role: 'plot.trace2', fallback: '#0000ff' } },
      ],
    });
    expect(stampSchemaVersion(doc)).toBe('1.1');
  });

  it('stamps 1.1 for a role deep in a child widget', () => {
    expect(stampSchemaVersion(withChild({ props: { background: role } }))).toBe('1.1');
  });

  it('ignores a malformed role-like object', () => {
    expect(stampSchemaVersion(withRootProps({ foreground: { $role: 'x', fallback: 'red' } }))).toBe(
      '1.0'
    );
  });

  it('does not depend on the incoming schemaVersion', () => {
    expect(stampSchemaVersion({ ...minimal, schemaVersion: '1.1' })).toBe('1.0');
    expect(stampSchemaVersion({ ...withConditional(role), schemaVersion: '1.0' })).toBe('1.1');
  });

  it('handles non-object input', () => {
    expect(stampSchemaVersion(null)).toBe('1.0');
    expect(stampSchemaVersion('x')).toBe('1.0');
  });
});
