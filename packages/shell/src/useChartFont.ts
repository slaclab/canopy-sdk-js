import { useLayoutEffect, useState } from 'react';
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
 * The family is read once per mount. `fontFamily` is undefined until then, and
 * for a wrapper that computes no family; `ready` is false in both cases.
 */
export function useChartFont(ref: RefObject<HTMLElement | null>): {
  fontFamily: string | undefined;
  ready: boolean;
} {
  const [read, setRead] = useState<{ fontFamily: string; doc: Document } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const doc = el.ownerDocument;
    const fontFamily = (doc.defaultView ?? window).getComputedStyle(el).fontFamily;
    setRead({ fontFamily, doc });
  }, [ref]);

  const fontFamily = read?.fontFamily || undefined;
  const ready = useFontsReady(fontFamily, read?.doc ?? document);
  return { fontFamily, ready };
}
