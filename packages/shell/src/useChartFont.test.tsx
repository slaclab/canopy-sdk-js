import { StrictMode, useRef } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChartFont } from './useChartFont.js';

type Load = (font: string) => Promise<unknown>;

// jsdom does not inherit font-family through getComputedStyle, so the wrapper
// carries its own family; it has no FontFaceSet either, so a test that watches
// the load stubs `fonts.load` on the wrapper's document.
function wrapperIn(doc: Document, family: string): HTMLElement {
  const el = doc.createElement('div');
  el.style.fontFamily = family;
  doc.body.appendChild(el);
  return el;
}

function stubFonts(doc: Document, load: Load): void {
  Object.defineProperty(doc, 'fonts', { value: { load }, configurable: true });
}

// Each test hands the hook a plain ref object, as `useRef` gives a component: the
// hook reads again only when the element behind it, or the key, changes.
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
    const opener = vi.spyOn(window, 'getComputedStyle');

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

  it('reports no family for a wrapper without one', async () => {
    const el = wrapperIn(document, '');
    const ref = { current: el };
    const { result } = renderHook(() => useChartFont(ref));
    await flush();
    expect(result.current).toEqual({ fontFamily: undefined, ready: false });
  });

  it('is ready only once the family has loaded in the wrapper document', async () => {
    let resolve!: (faces: unknown[]) => void;
    const load = vi.fn<Load>(() => new Promise((r) => (resolve = r)));
    const doc = document.implementation.createHTMLDocument('fonts');
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
    const doc = document.implementation.createHTMLDocument('fonts');
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

  it('reads a wrapper that mounts after the first commit', async () => {
    // A chart that renders nothing until its data arrives.
    function Chart({ data }: { data: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      const { fontFamily, ready } = useChartFont(ref);
      return data ? (
        <div ref={ref} style={{ fontFamily: 'IBM Plex Sans' }} data-testid="chart">
          {`${fontFamily ?? 'none'}:${ready}`}
        </div>
      ) : (
        <p data-testid="chart">{`${fontFamily ?? 'none'}:${ready}`}</p>
      );
    }

    const { getByTestId, rerender } = render(<Chart data={false} />);
    await flush();
    expect(getByTestId('chart').textContent).toBe('none:false');

    rerender(<Chart data />);
    await flush();
    expect(getByTestId('chart').textContent).toBe('IBM Plex Sans:true');
  });

  it('reads again when the element behind the ref changes, and clears when it goes', async () => {
    const first = wrapperIn(document, 'IBM Plex Sans');
    const second = wrapperIn(document, 'IBM Plex Mono');
    const ref: { current: HTMLElement | null } = { current: first };

    const { result, rerender } = renderHook(() => useChartFont(ref));
    await flush();
    expect(result.current).toEqual({ fontFamily: 'IBM Plex Sans', ready: true });

    ref.current = second;
    rerender();
    await flush();
    expect(result.current).toEqual({ fontFamily: 'IBM Plex Mono', ready: true });

    ref.current = null;
    rerender();
    await flush();
    expect(result.current).toEqual({ fontFamily: undefined, ready: false });
  });

  it('reads again when the key changes, and only then', async () => {
    const el = wrapperIn(document, 'IBM Plex Sans');
    const read = vi.spyOn(window, 'getComputedStyle');
    const ref = { current: el };
    const reads = () => read.mock.calls.filter(([target]) => target === el).length;

    const { result, rerender } = renderHook(({ theme }) => useChartFont(ref, theme), {
      initialProps: { theme: 'retro-dark' },
    });
    await flush();
    expect(result.current.fontFamily).toBe('IBM Plex Sans');

    // The host switched themes: the wrapper now computes another family.
    el.style.fontFamily = 'Probe Sans';
    rerender({ theme: 'retro-dark' });
    await flush();
    expect(result.current.fontFamily).toBe('IBM Plex Sans');
    expect(reads()).toBe(1);

    rerender({ theme: 'probe-a-dark' });
    await flush();
    expect(result.current).toEqual({ fontFamily: 'Probe Sans', ready: true });
    expect(reads()).toBe(2);
  });

  it('reads once under StrictMode', async () => {
    const el = wrapperIn(document, 'IBM Plex Sans');
    const read = vi.spyOn(window, 'getComputedStyle');
    const ref = { current: el };

    const { result } = renderHook(() => useChartFont(ref), { wrapper: StrictMode });
    await flush();

    expect(result.current).toEqual({ fontFamily: 'IBM Plex Sans', ready: true });
    expect(read.mock.calls.filter(([target]) => target === el)).toHaveLength(1);
  });
});
