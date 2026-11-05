import { describe, expect, it } from 'vitest';
import { isAction, readActions } from './index.js';
import type { Action } from './index.js';

const variants: Action[] = [
  { type: 'open_display', file: 'other.screen.json', target: 'replace' },
  { type: 'open_display', file: 'other.screen.json', macros: { P: 'X' }, target: 'tab' },
  { type: 'open_display', file: 'other.screen.json', target: 'window' },
  { type: 'write_pv', pvName: 'loc://x', value: 1 },
  { type: 'write_pv', pvName: 'SYS:PV', value: 'on' },
  { type: 'execute', command: 'ls -l' },
  { type: 'execute', command: 'ls -l', description: 'List' },
  { type: 'open_webpage', url: 'https://example.org' },
  { type: 'open_file', file: 'notes.txt' },
  { type: 'close_display' },
];

describe('isAction', () => {
  it.each(variants.map((v) => [v.type, v] as const))('accepts %s', (_t, v) => {
    expect(isAction(v)).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(isAction({ type: 'launch_rocket', target: 'moon' })).toBe(false);
  });

  it.each([
    ['null', null],
    ['string', 'open_display'],
    ['array', []],
    ['no type', { file: 'a' }],
    ['open_display without file', { type: 'open_display', target: 'tab' }],
    ['open_display bad target', { type: 'open_display', file: 'a', target: 'popup' }],
    [
      'open_display non-string macro',
      { type: 'open_display', file: 'a', target: 'tab', macros: { P: 1 } },
    ],
    ['write_pv without value', { type: 'write_pv', pvName: 'a' }],
    ['write_pv boolean value', { type: 'write_pv', pvName: 'a', value: true }],
    ['execute without command', { type: 'execute' }],
    ['execute numeric description', { type: 'execute', command: 'x', description: 3 }],
    ['open_webpage without url', { type: 'open_webpage' }],
    ['open_file without file', { type: 'open_file' }],
  ])('rejects %s', (_label, v) => {
    expect(isAction(v)).toBe(false);
  });
});

describe('readActions', () => {
  it('returns props.actions when every entry is an Action', () => {
    expect(readActions({ actions: variants })).toEqual(variants);
  });

  it('returns [] when any entry fails the guard', () => {
    expect(readActions({ actions: [variants[0], { type: 'nope' }] })).toEqual([]);
  });

  it('returns [] when actions is absent or not an array', () => {
    expect(readActions({})).toEqual([]);
    expect(readActions({ actions: 'open_display' })).toEqual([]);
    expect(readActions({ actions: null })).toEqual([]);
  });

  it('returns [] for an empty actions list', () => {
    expect(readActions({ actions: [] })).toEqual([]);
  });
});
