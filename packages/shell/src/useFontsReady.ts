import { useEffect, useState } from 'react';

// One load promise per family per document. A chart font is requested once,
// however many charts mount, and every later mount awaits the same promise.
const loads = new WeakMap<Document, Map<string, Promise<void>>>();

function loadFamily(family: string, doc: Document): Promise<void> {
  let perDoc = loads.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    loads.set(doc, perDoc);
  }
  let pending = perDoc.get(family);
  if (!pending) {
    // A rejected load still settles: the caller draws with the fallback face
    // instead of waiting forever. Documents without the Font Loading API
    // (jsdom, old embeds) have nothing to wait for.
    pending =
      doc.fonts && typeof doc.fonts.load === 'function'
        ? doc.fonts.load('1em ' + family).then(
            () => undefined,
            () => undefined
          )
        : Promise.resolve();
    perDoc.set(family, pending);
  }
  return pending;
}

/**
 * True once `family` has finished loading in `doc`, whether the load succeeded
 * or failed. False while `family` is undefined or empty.
 *
 * Canvas text (charts) is measured with whatever face is available at draw
 * time, so a consumer redraws when this flips to true.
 */
export function useFontsReady(family: string | undefined, doc: Document): boolean {
  const [settled, setSettled] = useState<{ family: string; doc: Document } | null>(null);

  useEffect(() => {
    if (!family) return;
    let live = true;
    void loadFamily(family, doc).then(() => {
      if (live) setSettled({ family, doc });
    });
    return () => {
      live = false;
    };
  }, [family, doc]);

  return !!family && settled !== null && settled.family === family && settled.doc === doc;
}
