import { describe, expect, it } from 'vitest';
import { isServerFallback, parseFlatScheme } from './index.js';
import type { FlatScheme, SchemeMeta } from './index.js';

const meta: SchemeMeta = {
  id: 'canopy-default',
  sha256: 'a'.repeat(64),
  flatHash: 'b'.repeat(16),
  served: 'canopy-default',
  errors: [],
};

const base = {
  roles: ['Text', 'Transparent', 'OK'],
  light: ['#000000', '#ffffff00', '#24a148'],
  dark: ['#f4f4f4', '#16161600', '#42be65'],
  meta,
};

function withField(field: string, value: unknown): Record<string, unknown> {
  return { ...base, [field]: value };
}

function withMeta(field: string, value: unknown): Record<string, unknown> {
  return { ...base, meta: { ...meta, [field]: value } };
}

describe('parseFlatScheme', () => {
  it('returns the scheme for a valid value', () => {
    const r = parseFlatScheme(base);
    expect(r).toEqual(base);
    expect('error' in r).toBe(false);
  });

  it('drops unknown fields from the result', () => {
    const r = parseFlatScheme({ ...base, extra: 1 }) as FlatScheme;
    expect(Object.keys(r).sort()).toEqual(['dark', 'light', 'meta', 'roles']);
  });

  it.each([
    ['null id', withMeta('id', null)],
    ['null sha256', withMeta('sha256', null)],
    ['null id and sha256', { ...base, meta: { ...meta, id: null, sha256: null } }],
    ['errors with entries', withMeta('errors', [{ path: '/roles/Text', message: 'bad' }])],
    ['empty scheme', { roles: [], light: [], dark: [], meta }],
  ])('accepts %s', (_label, v) => {
    expect('error' in parseFlatScheme(v)).toBe(false);
  });

  it.each([
    ['null', null],
    ['array', [base]],
    ['light shorter than roles', withField('light', ['#000000', '#ffffff00'])],
    ['dark longer than roles', withField('dark', [...base.dark, '#000000'])],
    ['duplicate roles', withField('roles', ['Text', 'OK', 'Text'])],
    ['empty role name', withField('roles', ['', 'Transparent', 'OK'])],
    ['65-character role', withField('roles', ['r'.repeat(65), 'Transparent', 'OK'])],
    ['non-string role', withField('roles', [1, 'Transparent', 'OK'])],
    ['3-digit #FFF', withField('light', ['#FFF', '#ffffff00', '#24a148'])],
    ['3-digit lowercase #fff', withField('light', ['#fff', '#ffffff00', '#24a148'])],
    ['uppercase 6-digit', withField('dark', ['#F4F4F4', '#16161600', '#42be65'])],
    ['ff alpha', withField('light', ['#000000ff', '#ffffff00', '#24a148'])],
    ['ff alpha in dark', withField('dark', ['#f4f4f4', '#161616ff', '#42be65'])],
    ['missing #', withField('light', ['000000', '#ffffff00', '#24a148'])],
    ['named color', withField('light', ['black', '#ffffff00', '#24a148'])],
    ['missing roles', { light: base.light, dark: base.dark, meta }],
    ['missing meta', { roles: base.roles, light: base.light, dark: base.dark }],
    ['undefined id', withMeta('id', undefined)],
    ['numeric sha256', withMeta('sha256', 5)],
    ['null flatHash', withMeta('flatHash', null)],
    ['missing served', withMeta('served', undefined)],
    ['errors not an array', withMeta('errors', {})],
    ['error entry without message', withMeta('errors', [{ path: '/x' }])],
  ])('rejects %s', (_label, v) => {
    const r = parseFlatScheme(v);
    expect(r).toHaveProperty('error');
    expect(typeof (r as { error: string }).error).toBe('string');
  });

  it('names the duplicate role in the error', () => {
    expect(parseFlatScheme(withField('roles', ['Text', 'OK', 'Text']))).toEqual({
      error: expect.stringContaining('"Text"'),
    });
  });
});

describe('isServerFallback', () => {
  const err = [{ path: '', message: 'scheme file not found' }];

  it.each<[string, SchemeMeta, boolean]>([
    [
      'default served with errors and null id',
      { ...meta, id: null, sha256: null, errors: err },
      true,
    ],
    [
      'default served with errors and a configured id',
      { ...meta, id: 'als-dark', errors: err },
      true,
    ],
    ['default served cleanly', meta, false],
    ['default served cleanly with null id', { ...meta, id: null, sha256: null }, false],
    ['custom scheme served', { ...meta, id: 'als', served: 'als', errors: err }, false],
  ])('%s -> %s', (_label, m, expected) => {
    expect(isServerFallback(m)).toBe(expected);
  });
});
