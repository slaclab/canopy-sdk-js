import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFontsReady } from './useFontsReady.js';

type Load = (font: string) => Promise<unknown>;

// jsdom has no FontFaceSet, and the cache is keyed by document: every test
// gets its own document with its own `fonts.load` stub.
function docWithFonts(load: Load): Document {
  const doc = document.implementation.createHTMLDocument('fonts');
  Object.defineProperty(doc, 'fonts', { value: { load }, configurable: true });
  return doc;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useFontsReady', () => {
  it('is false while the family is undefined and requests nothing', async () => {
    const load = vi.fn<Load>(() => Promise.resolve([]));
    const doc = docWithFonts(load);
    const { result } = renderHook(() => useFontsReady(undefined, doc));
    await flush();
    expect(result.current).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('is false for an empty family', async () => {
    const load = vi.fn<Load>(() => Promise.resolve([]));
    const doc = docWithFonts(load);
    const { result } = renderHook(() => useFontsReady('', doc));
    await flush();
    expect(result.current).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('turns true once the load resolves, and not before', async () => {
    let resolve!: (faces: unknown[]) => void;
    const load = vi.fn<Load>(() => new Promise((r) => (resolve = r)));
    const doc = docWithFonts(load);
    const { result } = renderHook(() => useFontsReady('IBM Plex Sans', doc));
    await flush();
    expect(result.current).toBe(false);
    expect(load).toHaveBeenCalledWith('1em IBM Plex Sans');

    resolve([]);
    await flush();
    expect(result.current).toBe(true);
  });

  it('turns true when the load rejects', async () => {
    let reject!: (reason: Error) => void;
    const load = vi.fn<Load>(() => new Promise((_, r) => (reject = r)));
    const doc = docWithFonts(load);
    const { result } = renderHook(() => useFontsReady('Missing Face', doc));
    await flush();
    expect(result.current).toBe(false);

    reject(new Error('network'));
    await flush();
    expect(result.current).toBe(true);
  });

  it('is ready at once in a document without the Font Loading API', async () => {
    const doc = document.implementation.createHTMLDocument('no fonts');
    const { result } = renderHook(() => useFontsReady('IBM Plex Sans', doc));
    await flush();
    expect(result.current).toBe(true);
  });

  it('shares one load between two mounts of one family in one document', async () => {
    const load = vi.fn<Load>(() => Promise.resolve([]));
    const doc = docWithFonts(load);
    const first = renderHook(() => useFontsReady('IBM Plex Mono', doc));
    const second = renderHook(() => useFontsReady('IBM Plex Mono', doc));
    await flush();
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    // A mount after the load settled reuses the stored promise too.
    const late = renderHook(() => useFontsReady('IBM Plex Mono', doc));
    await flush();
    expect(late.result.current).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads each family once: two families make two calls', async () => {
    const load = vi.fn<Load>(() => Promise.resolve([]));
    const doc = docWithFonts(load);
    const sans = renderHook(() => useFontsReady('IBM Plex Sans', doc));
    const mono = renderHook(() => useFontsReady('IBM Plex Mono', doc));
    await flush();
    expect(sans.result.current).toBe(true);
    expect(mono.result.current).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith('1em IBM Plex Sans');
    expect(load).toHaveBeenCalledWith('1em IBM Plex Mono');
  });

  it('keeps one cache per document', async () => {
    const loadA = vi.fn<Load>(() => Promise.resolve([]));
    const loadB = vi.fn<Load>(() => Promise.resolve([]));
    const docA = docWithFonts(loadA);
    const docB = docWithFonts(loadB);
    renderHook(() => useFontsReady('IBM Plex Sans', docA));
    renderHook(() => useFontsReady('IBM Plex Sans', docB));
    await flush();
    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it('drops back to false when the family changes, until the new one settles', async () => {
    let resolveMono!: (faces: unknown[]) => void;
    const load = vi.fn<Load>((font) =>
      font.endsWith('Mono') ? new Promise((r) => (resolveMono = r)) : Promise.resolve([])
    );
    const doc = docWithFonts(load);
    const { result, rerender } = renderHook(({ family }) => useFontsReady(family, doc), {
      initialProps: { family: 'IBM Plex Sans' },
    });
    await flush();
    expect(result.current).toBe(true);

    rerender({ family: 'IBM Plex Mono' });
    await flush();
    expect(result.current).toBe(false);

    resolveMono([]);
    await flush();
    expect(result.current).toBe(true);
  });
});
