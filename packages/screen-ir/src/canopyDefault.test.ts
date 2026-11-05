import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { CANOPY_DEFAULT_SCHEME_ID, canopyDefaultFlat, parseFlatScheme } from './index.js';

/** sha256 of the canonical canopy-default.json the flat file was generated from. */
const PACKAGED_SHA256 = '0a8f403e70f0b9a5dc2eb9679da24f72f54209e19a8a9043d3de636e49ce810d';

const BUILDER_DEFAULTS = ['Text', 'Read_Background', 'Background', 'On', 'Off'];
const D5_DEFAULTS = ['Text', 'Read_Background', 'Display_Background'];
const ALARM_ROLES = ['OK', 'MINOR', 'MAJOR', 'INVALID', 'DISCONNECTED'];
const CONTRAST_PAIRS = [
  'ActiveText',
  'Write_Background',
  'Header_ForeGround',
  'Header_Background',
  'Button_Background',
];
/** Grid splits by use: line colour (`Grid`) and the filled background (`Grid_Fill`). */
const GRID_ROLES = ['Grid', 'Grid_Fill'];

describe('canopyDefaultFlat', () => {
  it.each([
    ['Builder default table', BUILDER_DEFAULTS],
    ['D5 defaults', D5_DEFAULTS],
    ['alarm roles', ALARM_ROLES],
    ['contrast pairs', CONTRAST_PAIRS],
    ['grid roles', GRID_ROLES],
  ])('contains every role named by the %s', (_label, roles) => {
    for (const role of roles) expect(canopyDefaultFlat.roles).toContain(role);
  });

  it('carries the no-file meta of the packaged default', () => {
    expect(canopyDefaultFlat.meta.id).toBe(CANOPY_DEFAULT_SCHEME_ID);
    expect(canopyDefaultFlat.meta.served).toBe(CANOPY_DEFAULT_SCHEME_ID);
    expect(canopyDefaultFlat.meta.sha256).toBe(PACKAGED_SHA256);
    expect(canopyDefaultFlat.meta.errors).toEqual([]);
    expect(canopyDefaultFlat.meta.flatHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is a valid flat scheme with parallel light and dark arrays', () => {
    const parsed = parseFlatScheme(canopyDefaultFlat);
    expect(parsed).not.toHaveProperty('error');
    expect(parsed).toEqual(canopyDefaultFlat);
    expect(canopyDefaultFlat.light).toHaveLength(canopyDefaultFlat.roles.length);
    expect(canopyDefaultFlat.dark).toHaveLength(canopyDefaultFlat.roles.length);
  });

  it('ships the data directory in the package', () => {
    expect(pkg.files).toContain('data');
  });
});
