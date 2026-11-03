import { describe, expect, it, vi } from 'vitest';
import { LocalPVService, parseLocUrl } from './LocalPVService.js';
import { RoutedPVService } from './RoutedPVService.js';
import { MockPVService } from './MockPVService.js';

describe('parseLocUrl', () => {
  it('parses the declaring form', () => {
    expect(parseLocUrl('loc://${!W}posVis?type=int&init=0')).toEqual({
      name: '${!W}posVis',
      type: 'int',
      init: '0',
    });
  });

  it('parses the short form', () => {
    expect(parseLocUrl('loc://tab')).toEqual({ name: 'tab' });
  });

  it('rejects non-loc addresses', () => {
    expect(parseLocUrl('DEV:X')).toBeNull();
  });

  it('parses the Phoebus form with a VType and an initialiser', () => {
    expect(parseLocUrl('loc://x<VDouble>(1.5)')).toEqual({
      name: 'x',
      vtype: 'VDouble',
      init: '1.5',
    });
  });

  it('parses a VType without an initialiser and an initialiser without a VType', () => {
    expect(parseLocUrl('loc://x<VInt>')).toEqual({ name: 'x', vtype: 'VInt' });
    expect(parseLocUrl('loc://x(2)')).toEqual({ name: 'x', init: '2' });
    expect(parseLocUrl('loc://x()')).toEqual({ name: 'x', init: '' });
  });

  it('keeps the initialiser text verbatim, quotes and all', () => {
    expect(parseLocUrl('loc://s<VString>("a b")')).toEqual({
      name: 's',
      vtype: 'VString',
      init: '"a b"',
    });
    expect(parseLocUrl('loc://s("f(x)?")')).toEqual({ name: 's', init: '"f(x)?"' });
    expect(parseLocUrl('loc://a<VDoubleArray>(1, 2, 3)')).toEqual({
      name: 'a',
      vtype: 'VDoubleArray',
      init: '1, 2, 3',
    });
  });

  it('recognises a group that closes right before the query', () => {
    expect(parseLocUrl('loc://x<VInt>(2)?type=str&init=9')).toEqual({
      name: 'x',
      vtype: 'VInt',
      init: '2',
      type: 'str',
    });
    expect(parseLocUrl('loc://x<VInt>?init=9')).toEqual({ name: 'x', vtype: 'VInt', init: '9' });
  });

  it('takes the whole text before the query as the name when no group closes there', () => {
    expect(parseLocUrl('loc://a(b)c')).toEqual({ name: 'a(b)c' });
    expect(parseLocUrl('loc://a<b>c')).toEqual({ name: 'a<b>c' });
    expect(parseLocUrl('loc://a<b>c?type=int&init=1')).toEqual({
      name: 'a<b>c',
      type: 'int',
      init: '1',
    });
    expect(parseLocUrl('loc://x<VInt')).toEqual({ name: 'x<VInt' });
    expect(parseLocUrl('loc://x?type=str&init=f(a)')).toEqual({
      name: 'x',
      type: 'str',
      init: 'f(a)',
    });
  });

  it('never reads an unresolved $(NAME) macro as an initialiser', () => {
    expect(parseLocUrl('loc://sel$(P)')).toEqual({ name: 'sel$(P)' });
    expect(parseLocUrl('loc://$(A)sel?type=int&init=0')).toEqual({
      name: '$(A)sel',
      type: 'int',
      init: '0',
    });
    expect(parseLocUrl('loc://$(B)tab')).toEqual({ name: '$(B)tab' });
    expect(parseLocUrl('loc://sel$(P)(3)')).toEqual({ name: 'sel$(P)', init: '3' });
    expect(parseLocUrl('loc://sel$(P)<VInt>(3)')).toEqual({
      name: 'sel$(P)',
      vtype: 'VInt',
      init: '3',
    });
    expect(parseLocUrl('loc://x($(P))')).toEqual({ name: 'x', init: '$(P)' });
  });
});

describe('LocalPVService', () => {
  it('initializes from the declaring URL and delivers synchronously', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://sel?type=int&init=2', listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ value: 2, connected: true });
  });

  it('short-form reads are disconnected until a declaration or put arrives', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://sel', listener);
    expect(listener.mock.calls[0]![0].connected).toBe(false);

    // A later declaring reference initializes the same local (shared name).
    const other = vi.fn();
    service.subscribe('loc://sel?type=int&init=7', other);
    expect(listener.mock.lastCall![0]).toMatchObject({ value: 7, connected: true });
  });

  it('put updates every subscriber under any URL form of the same name', () => {
    const service = new LocalPVService();
    service.connect();
    const a = vi.fn();
    const b = vi.fn();
    service.subscribe('loc://sel?type=int&init=0', a);
    service.subscribe('loc://sel', b);
    service.put('loc://sel', 3);
    expect(a.mock.lastCall![0].value).toBe(3);
    expect(b.mock.lastCall![0].value).toBe(3);
    expect(service.getSnapshot('loc://sel')?.value).toBe(3);
  });

  it('re-declaration does not reset an initialized local (first wins)', () => {
    const service = new LocalPVService();
    service.connect();
    service.put('loc://sel?type=int&init=0', 5);
    const listener = vi.fn();
    service.subscribe('loc://sel?type=int&init=0', listener);
    expect(listener.mock.calls[0]![0].value).toBe(5);
  });

  it('clear() resets scope: locals disconnect and re-initialize fresh', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://sel?type=int&init=1', listener);
    service.put('loc://sel', 9);
    service.clear();
    expect(listener.mock.lastCall![0].connected).toBe(false);
    // Next declaring subscribe re-initializes.
    const fresh = vi.fn();
    service.subscribe('loc://sel?type=int&init=1', fresh);
    expect(fresh.mock.lastCall![0]).toMatchObject({ value: 1, connected: true });
  });

  it('keeps string locals as strings', () => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://label?type=str&init=OFF', listener);
    expect(listener.mock.calls[0]![0].value).toBe('OFF');
  });

  const declared = (url: string) => {
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe(url, listener);
    return listener.mock.calls[0]![0];
  };

  it.each([
    ['loc://x<VDouble>(1.5)', 1.5],
    ['loc://x<VLong>(7)', 7],
    ['loc://x<VInt>(2)', 2],
    ['loc://x<VEnum>(1)', 1],
    ['loc://x<VEnum>(1, "off", "on")', 1],
    ['loc://x(1.5)', 1.5],
    ['loc://x(-3)', -3],
    ['loc://x( 4 )', 4],
  ])('%s declares the number', (url, value) => {
    expect(declared(url)).toMatchObject({ value, valueKind: 'scalar', connected: true });
  });

  it.each([
    ['loc://s<VString>("a b")', 'a b'],
    ["loc://s<VString>('a b')", 'a b'],
    ['loc://s<VString>(plain)', 'plain'],
    ['loc://s<VString>(12)', '12'],
    ['loc://s<VString>("")', ''],
    ['loc://s("a")', 'a'],
    ['loc://s("12")', '12'],
    ['loc://s("say \'hi\'")', "say 'hi'"],
    ['loc://s("f(x)?, ok")', 'f(x)?, ok'],
    ['loc://s(word)', 'word'],
    ['loc://s()', ''],
  ])('%s declares the string', (url, value) => {
    expect(declared(url)).toMatchObject({ value, valueKind: 'string', connected: true });
  });

  it('declares array locals with the element type of the VType', () => {
    expect(declared('loc://a<VDoubleArray>(1, 2.5, -3)')).toMatchObject({
      value: [1, 2.5, -3],
      valueKind: 'waveform',
      connected: true,
    });
    expect(declared('loc://a<VStringArray>("a", \'b,c\', d)')).toMatchObject({
      value: ['a', 'b,c', 'd'],
      valueKind: 'waveform',
      connected: true,
    });
    expect(declared('loc://a<VStringArray>(1, 2)').value).toEqual(['1', '2']);
    expect(declared('loc://a<VDoubleArray>()').value).toEqual([]);
  });

  it('a VType without an initialiser leaves the local disconnected', () => {
    expect(declared('loc://x<VDouble>').connected).toBe(false);
  });

  it('every spelling of one name shares one PV', () => {
    const service = new LocalPVService();
    service.connect();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listeners = ['loc://x', 'loc://x(1.5)', 'loc://x("a")', 'loc://x<VInt>(2)'].map((url) => {
      const listener = vi.fn();
      service.subscribe(url, listener);
      return listener;
    });
    // The first initialiser wins, and the bare reference subscribed before it sees it.
    for (const listener of listeners) expect(listener.mock.lastCall![0].value).toBe(1.5);

    service.put('loc://x<VInt>(2)', 8);
    for (const listener of listeners) expect(listener.mock.lastCall![0].value).toBe(8);
    for (const url of [
      'loc://x',
      'loc://x(1.5)',
      'loc://x("a")',
      'loc://x<VInt>(2)',
      'loc://x?type=int',
    ]) {
      expect(service.getSnapshot(url)?.value).toBe(8);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps macro-carrying names apart and intact', () => {
    const service = new LocalPVService();
    service.connect();
    const sel = vi.fn();
    const tab = vi.fn();
    service.subscribe('loc://$(A)sel?type=int&init=0', sel);
    service.subscribe('loc://$(B)tab', tab);
    expect(sel.mock.lastCall![0]).toMatchObject({ value: 0, connected: true });
    expect(tab.mock.lastCall![0].connected).toBe(false);
    service.put('loc://$(B)tab', 4);
    expect(sel.mock.lastCall![0].value).toBe(0);
    expect(tab.mock.lastCall![0].value).toBe(4);

    const bare = vi.fn();
    service.subscribe('loc://sel$(P)', bare);
    expect(bare.mock.lastCall![0].connected).toBe(false);
    service.subscribe('loc://sel$(P)(3)', vi.fn());
    expect(bare.mock.lastCall![0]).toMatchObject({ value: 3, connected: true });
    expect(service.getSnapshot('loc://sel$(P)')?.value).toBe(3);
  });

  it('warns once per name for an unsupported VType and leaves the local undeclared', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    expect(() => service.subscribe('loc://t<VTable>', listener)).not.toThrow();
    service.subscribe('loc://t<VTable>', vi.fn());
    expect(service.getSnapshot('loc://t<VTable>')?.connected).toBe(false);
    expect(listener.mock.lastCall![0].connected).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('VTable');

    service.subscribe('loc://u<VTable>(1)', vi.fn());
    expect(warn).toHaveBeenCalledTimes(2);

    // A supported declaration of the same name still initialises it.
    service.subscribe('loc://t<VInt>(5)', vi.fn());
    expect(listener.mock.lastCall![0]).toMatchObject({ value: 5, connected: true });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('warns once per name when a second declaration names a different type (first wins)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://x<VInt>(2)', listener);
    expect(() => service.subscribe('loc://x<VString>("a")', vi.fn())).not.toThrow();
    service.subscribe('loc://x?type=str&init=b', vi.fn());
    service.subscribe('loc://x<VDoubleArray>(1, 2)', vi.fn());
    expect(listener.mock.lastCall![0]).toMatchObject({ value: 2, valueKind: 'scalar' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('loc://x');

    // Two numeric spellings are one type; no warning.
    service.subscribe('loc://y<VInt>(2)', vi.fn());
    service.subscribe('loc://y<VDouble>(3)', vi.fn());
    service.subscribe('loc://y?type=float&init=4', vi.fn());
    expect(warn).toHaveBeenCalledTimes(1);

    // The first type wins even before any value arrived.
    const late = vi.fn();
    service.subscribe('loc://z<VString>', late);
    service.subscribe('loc://z<VInt>(1)', vi.fn());
    expect(late.mock.lastCall![0].connected).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('clear() forgets declared types and warnings with the scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new LocalPVService();
    service.connect();
    const listener = vi.fn();
    service.subscribe('loc://x<VInt>(2)', listener);
    service.clear();
    service.subscribe('loc://x<VString>("a")', vi.fn());
    expect(listener.mock.lastCall![0]).toMatchObject({ value: 'a', valueKind: 'string' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('RoutedPVService', () => {
  it('routes loc:// to the local service and the rest to the fallback', () => {
    const local = new LocalPVService();
    const fallback = new MockPVService();
    const routed = new RoutedPVService({ 'loc://': local }, fallback);
    routed.connect();

    const locListener = vi.fn();
    routed.subscribe('loc://x?type=int&init=4', locListener);
    expect(locListener.mock.calls[0]![0].value).toBe(4);

    const caListener = vi.fn();
    routed.subscribe('DEV:PRESSURE', caListener);
    expect(caListener).toHaveBeenCalled();
    expect(local.getSnapshot('DEV:PRESSURE')).toBeUndefined();

    routed.put('loc://x', 6);
    expect(local.getSnapshot('loc://x')?.value).toBe(6);
  });
});
