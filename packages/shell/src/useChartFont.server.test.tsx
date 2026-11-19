// @vitest-environment node

import { useRef } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useChartFont } from './useChartFont.js';
import { useFontsReady } from './useFontsReady.js';

// Server rendering: no document, and effects never run. Both hooks render their initial,
// not-ready state instead of touching `document`.

function Chart() {
  const ref = useRef<HTMLDivElement>(null);
  const { fontFamily, ready } = useChartFont(ref, 'retro-dark');
  return <div ref={ref} data-font={fontFamily ?? 'none'} data-ready={String(ready)} />;
}

function Fonts() {
  return <p data-ready={String(useFontsReady('IBM Plex Sans'))} />;
}

describe('server rendering', () => {
  it('runs without a document', () => {
    expect(typeof document).toBe('undefined');
  });

  it('renders useChartFont with no family, not ready', () => {
    expect(renderToString(<Chart />)).toBe('<div data-font="none" data-ready="false"></div>');
  });

  it('renders useFontsReady without a document as not ready', () => {
    expect(renderToString(<Fonts />)).toBe('<p data-ready="false"></p>');
  });
});
