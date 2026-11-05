import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import schema from '../spec/screen-ir/color-scheme.schema.json' with { type: 'json' };

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const n64 = 'r'.repeat(64);
const n65 = 'r'.repeat(65);

const accepted: [string, unknown][] = [
  ['minimal scheme (id only)', { id: 'x' }],
  ['empty extending scheme', { id: 'x', extends: 'canopy-default', roles: {} }],
  ['3-digit hex', { id: 'x', roles: { bg: '#fff' } }],
  ['6-digit hex', { id: 'x', roles: { bg: '#ffffff' } }],
  ['8-digit hex', { id: 'x', roles: { bg: '#ffffff80' } }],
  ['mixed-case hex', { id: 'x', roles: { bg: '#AbCdEf' } }],
  ['alias', { id: 'x', roles: { bg: '@Other' } }],
  ['light only', { id: 'x', roles: { bg: { light: '#000' } } }],
  ['dark only', { id: 'x', roles: { bg: { dark: '#000000' } } }],
  ['empty per-mode object', { id: 'x', roles: { bg: {} } }],
  ['alias and hex per mode', { id: 'x', roles: { bg: { light: '@X', dark: '#000' } } }],
  ['64-character role name', { id: 'x', roles: { [n64]: '#000' } }],
  ['64-character alias name', { id: 'x', roles: { bg: `@${n64}` } }],
  [
    'role name with dots and spaces',
    { id: 'x', roles: { 'alarm.major': '#f00', 'Text FG': '#000' } },
  ],
  [
    'import mappings with null',
    { id: 'x', import: { phoebus: { OK: 'ok', Foo: null }, edm: { 'Top Shadow': 'shadow.top' } } },
  ],
  ['empty import', { id: 'x', import: {} }],
  ['64-character import names', { id: 'x', import: { phoebus: { [n64]: n64 } } }],
  [
    'role with phoebus source',
    { id: 'x', roles: { Grid: { light: '#c6c6c6', phoebus: '#C8C8C8' } } },
  ],
  ['role with phoebus source only', { id: 'x', roles: { Grid: { phoebus: '#fff' } } }],
  [
    'slot-aware import object',
    { id: 'x', import: { phoebus: { Grid: { role: 'Grid', background_color: 'Grid_Fill' } } } },
  ],
  [
    'slot-aware import object with role only',
    { id: 'x', import: { edm: { Grid: { role: 'Grid' } } } },
  ],
  [
    'string, null and slot imports together',
    {
      id: 'x',
      import: { phoebus: { OK: 'ok', Foo: null, Grid: { role: 'Grid', line_color: 'Grid_Line' } } },
    },
  ],
];

const rejected: [string, unknown][] = [
  ['missing id', { roles: {} }],
  ['non-string id', { id: 1 }],
  ['extends other', { id: 'x', extends: 'other' }],
  ['unknown top-level key', { id: 'x', colors: {} }],
  ['bad hex (2 digits)', { id: 'x', roles: { bg: '#ff' } }],
  ['bad hex (non-hex digits)', { id: 'x', roles: { bg: '#gggggg' } }],
  ['bad hex (5 digits)', { id: 'x', roles: { bg: '#fffff' } }],
  ['hex without #', { id: 'x', roles: { bg: 'ff0000' } }],
  ['named color', { id: 'x', roles: { bg: 'red' } }],
  ['@ with empty name', { id: 'x', roles: { bg: '@' } }],
  ['@ with empty name per mode', { id: 'x', roles: { bg: { dark: '@' } } }],
  ['65-character alias name', { id: 'x', roles: { bg: `@${n65}` } }],
  ['65-character role name', { id: 'x', roles: { [n65]: '#000' } }],
  ['empty role name', { id: 'x', roles: { '': '#000' } }],
  ['null role value', { id: 'x', roles: { bg: null } }],
  ['extra key in per-mode object', { id: 'x', roles: { bg: { light: '#000', hc: '#fff' } } }],
  ['bad hex per mode', { id: 'x', roles: { bg: { light: '#12' } } }],
  ['unknown import source', { id: 'x', import: { css: { a: 'b' } } }],
  ['65-character import key', { id: 'x', import: { phoebus: { [n65]: 'ok' } } }],
  ['65-character import target', { id: 'x', import: { edm: { a: n65 } } }],
  ['empty import target', { id: 'x', import: { edm: { a: '' } } }],
  ['non-string import target', { id: 'x', import: { phoebus: { a: 3 } } }],
  ['bad phoebus hex', { id: 'x', roles: { Grid: { phoebus: '#c6c6' } } }],
  ['phoebus alias', { id: 'x', roles: { Grid: { phoebus: '@Other' } } }],
  ['unknown role-object key', { id: 'x', roles: { Grid: { light: '#000', edm: '#fff' } } }],
  [
    'slot object without role',
    { id: 'x', import: { phoebus: { Grid: { background_color: 'Grid_Fill' } } } },
  ],
  ['slot object with empty role', { id: 'x', import: { phoebus: { Grid: { role: '' } } } }],
  [
    'slot object with null slot',
    { id: 'x', import: { phoebus: { Grid: { role: 'Grid', background_color: null } } } },
  ],
  [
    'slot object with 65-character slot role',
    { id: 'x', import: { phoebus: { Grid: { role: 'Grid', background_color: n65 } } } },
  ],
  [
    'slot object with empty slot name',
    { id: 'x', import: { phoebus: { Grid: { role: 'Grid', '': 'Grid_Fill' } } } },
  ],
];

describe('canopy-color-scheme/1 schema', () => {
  it('is a draft 2020-12 schema', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('is published as ./color-scheme.schema.json', () => {
    const exports = pkg.exports as Record<string, unknown>;
    expect(exports['./color-scheme.schema.json']).toBe('./spec/screen-ir/color-scheme.schema.json');
    expect(pkg.files).toContain('spec/screen-ir');
  });

  it.each(accepted)('accepts %s', (_label, doc) => {
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(rejected)('rejects %s', (_label, doc) => {
    expect(validate(doc)).toBe(false);
  });
});
