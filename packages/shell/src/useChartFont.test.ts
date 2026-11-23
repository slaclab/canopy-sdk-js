import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChartFont } from './useChartFont.js';

type Load = (font: string) => Promise<unknown>;

// The wrapper carries its own family, so each test reads a known one. jsdom has
// no FontFaceSet, so a test that watches the load stubs `fonts.load` on the
// wrapper's document.
function wrapperIn(doc: Document, family: string): HTMLElement {
  const el = doc.createElement('div');
  el.style.fontFamily = family;
  doc.body.appendChild(el);
  return el;
}

// A second document with its own window, as a pop-out's is.
function frameDocument(): Document {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  return frame.contentDocument!;
}

function stubFonts(doc: Document, load: Load): void {
  Object.defineProperty(doc, 'fonts', { value: { load }, configurable: true });
}

// A stable ref object, as `useRef` gives a component: the hook reads again only
// when it is handed a different ref.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'fonts');
  vi.restoreAllMocks();
});

describe('useChartFont', () => {
  it("reads the wrapper's computed font family", async () => {
    const el = wrapperIn(document, 'IBM Plex Sans');
    const ref = { current: el };
    const { result } = renderHook(() => useChartFont(ref));
    expect(result.current.fontFamily).toBe('IBM Plex Sans');
    await flush();
    expect(result.current.fontFamily).toBe('IBM Plex Sans');
  });

  it('reads through the window of the document that owns the wrapper', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const frameDoc = frame.contentDocument!;
    const frameWin = frameDoc.defaultView!;
    const own = vi.spyOn(frameWin, 'getComputedStyle');
    const opener = vi.spyOn(window, 'getComputedStyle');
    const el = wrapperIn(frameDoc, 'Inter');

    const ref = { current: el };
    const { result } = renderHook(() => useChartFont(ref));

    expect(result.current.fontFamily).toBe('Inter');
    expect(own.mock.calls.filter(([target]) => target === el)).toHaveLength(1);
    expect(opener.mock.calls.filter(([target]) => target === el)).toHaveLength(0);
  });

  it('falls back to the opener window for a document without a window', async () => {
    const doc = document.implementation.createHTMLDocument('detached');
    expect(doc.defaultView).toBeNull();
    const el = wrapperIn(doc, 'IBM Plex Mono');
    // Like a browser, jsdom computes nothing for a windowless document, so the
    // opener's answer is stubbed: this test pins which window the hook asks.
    const compute = window.getComputedStyle.bind(window);
    const opener = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((target) =>
        target === el ? ({ fontFamily: 'IBM Plex Mono' } as CSSStyleDeclaration) : compute(target)
      );

    const ref = { current: el };
    const { result } = renderHook(() => useChartFont(ref));

    expect(result.current.fontFamily).toBe('IBM Plex Mono');
    expect(opener).toHaveBeenCalledWith(el);
    await flush();
    expect(result.current.ready).toBe(true);
  });

  it('stays undefined and not ready while the ref is empty', async () => {
    const load = vi.fn<Load>(() => Promise.resolve([]));
    stubFonts(document, load);
    const ref = { current: null };
    const { result } = renderHook(() => useChartFont(ref));
    await flush();
    expect(result.current).toEqual({ fontFamily: undefined, ready: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('reports no family for a wrapper whose document computes none', async () => {
    const el = wrapperIn(document.implementation.createHTMLDocument('detached'), 'Inter');
    const ref = { current: el };
    const { result } = renderHook(() => useChartFont(ref));
    await flush();
    expect(result.current).toEqual({ fontFamily: undefined, ready: false });
  });

  it('is ready only once the family has loaded in the wrapper document', async () => {
    let resolve!: (faces: unknown[]) => void;
    const load = vi.fn<Load>(() => new Promise((r) => (resolve = r)));
    const doc = frameDocument();
    stubFonts(doc, load);
    const el = wrapperIn(doc, 'IBM Plex Sans');

    const ref = { current: el };
    const { result } = renderHook(() => useChartFont(ref));
    await flush();
    expect(result.current).toEqual({ fontFamily: 'IBM Plex Sans', ready: false });
    expect(load).toHaveBeenCalledWith('1em IBM Plex Sans');

    resolve([]);
    await flush();
    expect(result.current).toEqual({ fontFamily: 'IBM Plex Sans', ready: true });
  });

  it('is ready when the load rejects, so the chart draws with the fallback face', async () => {
    const load = vi.fn<Load>(() => Promise.reject(new Error('network')));
    const doc = frameDocument();
    stubFonts(doc, load);
    const el = wrapperIn(doc, 'Missing Face');

    const ref = { current: el };
    const { result } = renderHook(() => useChartFont(ref));
    await flush();
    expect(result.current).toEqual({ fontFamily: 'Missing Face', ready: true });
  });

  it('reads the family once per mount', async () => {
    const el = wrapperIn(document, 'IBM Plex Sans');
    const read = vi.spyOn(window, 'getComputedStyle');
    const ref = { current: el };

    const { result, rerender } = renderHook(() => useChartFont(ref));
    await flush();
    el.style.fontFamily = 'IBM Plex Mono';
    rerender();
    await flush();

    expect(result.current.fontFamily).toBe('IBM Plex Sans');
    expect(read.mock.calls.filter(([target]) => target === el)).toHaveLength(1);
  });
});
