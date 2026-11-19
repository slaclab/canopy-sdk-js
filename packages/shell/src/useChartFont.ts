import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useFontsReady } from './useFontsReady.js';

/**
 * The font family a chart should draw with, read from its wrapper element, and
 * whether that family has finished loading.
 *
 * Canvas text does not inherit CSS, so a chart is handed the family its wrapper
 * computes. The read is relative to the wrapper's own document: a chart moved
 * into a detached window follows that window's stylesheet and font set, not the
 * opener's. A document without a window is measured through the opener window.
 *
 * The family is read after the first commit that has an element behind `ref`,
 * so a wrapper that mounts late (a chart that renders nothing until its data
 * arrives) is read when it appears. It is read again when that element changes
 * and whenever `key` changes: pass the host theme id, or anything else that
 * changes the wrapper's font while it stays mounted. A re-render with the same
 * element and key reads nothing. The element is checked after each render of
 * the component that calls the hook.
 *
 * `fontFamily` is undefined while there is no wrapper and for a wrapper that
 * computes no family; `ready` is false in both cases. On the server nothing is
 * read and both stay in that state.
 *
 * @param ref - The chart's wrapper element.
 * @param key - Any value; a change forces a re-read of the same element.
 */
export function useChartFont(
  ref: RefObject<HTMLElement | null>,
  key?: unknown
): {
  fontFamily: string | undefined;
  ready: boolean;
} {
  const [read, setRead] = useState<{ fontFamily: string; doc: Document } | null>(null);
  // The element and key of the last read. Attaching a ref object re-renders
  // nothing, so the effect runs after every commit and compares against this.
  const source = useRef<{ el: HTMLElement | null; key: unknown } | null>(null);

  // No dependency list on purpose: no dependency changes when the element
  // behind the ref does. The `source` check that opens the effect ends the
  // update chain its `setRead` starts.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  useLayoutEffect(() => {
    const el = ref.current;
    const last = source.current;
    if (last !== null && last.el === el && Object.is(last.key, key)) return;
    source.current = { el, key };
    if (!el) {
      setRead(null);
      return;
    }
    const doc = el.ownerDocument;
    const fontFamily = (doc.defaultView ?? window).getComputedStyle(el).fontFamily;
    setRead((prev) =>
      prev !== null && prev.fontFamily === fontFamily && prev.doc === doc
        ? prev
        : { fontFamily, doc }
    );
  });

  const fontFamily = read?.fontFamily || undefined;
  const ready = useFontsReady(fontFamily, read?.doc);
  return { fontFamily, ready };
}
