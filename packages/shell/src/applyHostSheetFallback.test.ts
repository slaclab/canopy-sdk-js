import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyHostSheetFallback } from './applyHostSheetFallback.js';

/** A hosted document: the page marker is set, as the host sets it. */
function hostedDocument(): Document {
  const doc = document.implementation.createHTMLDocument('applyHostSheetFallback');
  doc.documentElement.dataset.canopyHost = '';
  return doc;
}

/** Appends a marked host sheet link; jsdom never loads it, so `sheet` is null. */
function addHostLink(doc: Document, href: string): HTMLLinkElement {
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.canopyHostSheet = '';
  doc.head.appendChild(link);
  return link;
}

function stubSheet(link: HTMLLinkElement, sheet: unknown): void {
  Object.defineProperty(link, 'sheet', { value: sheet, configurable: true });
}

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

const isHosted = (doc: Document) => doc.documentElement.hasAttribute('data-canopy-host');

afterEach(() => {
  delete document.documentElement.dataset.canopyHost;
  document.head.replaceChildren();
  vi.restoreAllMocks();
});

describe('applyHostSheetFallback', () => {
  it('clears the host marker when a marked link has no sheet', () => {
    const warn = spyWarn();
    const doc = hostedDocument();
    const link = addHostLink(doc, 'https://host.example/canopy/host.css');
    expect(link.sheet).toBeNull();

    applyHostSheetFallback(doc);

    expect(isHosted(doc)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('https://host.example/canopy/host.css');
  });

  it('clears the host marker when a marked sheet loaded without rules', () => {
    const warn = spyWarn();
    const doc = hostedDocument();
    stubSheet(addHostLink(doc, 'https://host.example/empty.css'), { cssRules: [] });

    applyHostSheetFallback(doc);

    expect(isHosted(doc)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('https://host.example/empty.css');
  });

  it('keeps the host marker when a marked sheet has rules', () => {
    const warn = spyWarn();
    const doc = hostedDocument();
    stubSheet(addHostLink(doc, 'https://host.example/host.css'), { cssRules: [{}] });

    applyHostSheetFallback(doc);

    expect(isHosted(doc)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('counts a sheet whose rules cannot be read as loaded', () => {
    const warn = spyWarn();
    const doc = hostedDocument();
    stubSheet(addHostLink(doc, 'https://other.example/host.css'), {
      get cssRules(): CSSRuleList {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    });

    applyHostSheetFallback(doc);

    expect(isHosted(doc)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves the document alone when no link is marked', () => {
    const warn = spyWarn();
    const doc = hostedDocument();
    const plain = doc.createElement('link');
    plain.rel = 'stylesheet';
    plain.href = 'https://host.example/unmarked.css';
    doc.head.appendChild(plain);

    applyHostSheetFallback(doc);

    expect(isHosted(doc)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once for two dead links, naming both', () => {
    const warn = spyWarn();
    const doc = hostedDocument();
    addHostLink(doc, 'https://host.example/a.css');
    stubSheet(addHostLink(doc, 'https://host.example/b.css'), { cssRules: [] });

    applyHostSheetFallback(doc);

    expect(isHosted(doc)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('https://host.example/a.css');
    expect(message).toContain('https://host.example/b.css');
  });

  it('clears the marker when one of two marked links is dead', () => {
    const warn = spyWarn();
    const doc = hostedDocument();
    stubSheet(addHostLink(doc, 'https://host.example/ok.css'), { cssRules: [{}] });
    addHostLink(doc, 'https://host.example/dead.css');

    applyHostSheetFallback(doc);

    expect(isHosted(doc)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('https://host.example/dead.css');
    expect(message).not.toContain('https://host.example/ok.css');
  });

  it('defaults to the global document', () => {
    const warn = spyWarn();
    document.documentElement.dataset.canopyHost = '';
    addHostLink(document, 'https://host.example/global.css');

    applyHostSheetFallback();

    expect(isHosted(document)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
