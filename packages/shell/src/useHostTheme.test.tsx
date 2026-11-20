import { StrictMode } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColorMode } from './themeStore.js';
import { HOST_THEME_ID, modeFromThemeId, useHostTheme } from './useHostTheme.js';

// jsdom does not resolve custom properties through the cascade, so a test that
// needs a contract version puts it on the anchor's own inline style.
function Root({ raw, mode, contract }: { raw: string | null; mode: ColorMode; contract?: string }) {
  const { anchorRef, anchorProps } = useHostTheme<HTMLDivElement>(raw, mode);
  const style =
    contract === undefined ? undefined : ({ '--canopy-host-contract': contract } as CSSProperties);
  return <div ref={anchorRef} {...anchorProps} style={style} data-testid="anchor" />;
}

function PortalRoot({ target, mode }: { target: HTMLElement; mode: ColorMode }) {
  return createPortal(<Root raw={null} mode={mode} contract="1" />, target);
}

function markHosted(doc: Document = document): void {
  doc.documentElement.dataset.canopyHost = '';
}

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.canopyHost;
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('HOST_THEME_ID', () => {
  it('accepts lower-case ids of up to 40 characters', () => {
    expect(HOST_THEME_ID.test('retro-dark')).toBe(true);
    expect(HOST_THEME_ID.test('a')).toBe(true);
    expect(HOST_THEME_ID.test('a'.repeat(40))).toBe(true);
  });

  it('rejects paths, upper case, a leading hyphen, empty and over-long ids', () => {
    for (const bad of ['../x', 'Dark', '-dark', '', 'a'.repeat(41), 'a b', 'dark"]', 'dark\n']) {
      expect(HOST_THEME_ID.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('modeFromThemeId', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['desy-dark', 'dark'],
    ['desy-light', 'light'],
    ['high-contrast-dark', 'dark'],
    ['high-contrast-light', 'light'],
    ['retro-dark', 'dark'],
    ['retro-light', 'light'],
  ] as const)('reads %s as %s', (id, mode) => {
    expect(modeFromThemeId(id)).toBe(mode);
  });

  it('reads an unknown id as dark unless it ends in -light', () => {
    expect(modeFromThemeId('solarized')).toBe('dark');
    expect(modeFromThemeId('lightning')).toBe('dark');
    expect(modeFromThemeId('solarized-light')).toBe('light');
  });
});

describe('useHostTheme id', () => {
  it('falls back to the mode when the host sent no id', () => {
    const { result } = renderHook(() => useHostTheme(null, 'light'));
    expect(result.current.id).toBe('light');
    expect(result.current.anchorProps['data-theme']).toBe('light');
  });

  it('never matches null as the string "null"', () => {
    expect(HOST_THEME_ID.test(null as unknown as string)).toBe(true);
    const { result } = renderHook(() => useHostTheme(null, 'dark'));
    expect(result.current.id).toBe('dark');
  });

  it('falls back to the mode for an id that is not a theme id', () => {
    const { result } = renderHook(() => useHostTheme('../x', 'dark'));
    expect(result.current.id).toBe('dark');
    expect(result.current.anchorProps['data-theme']).toBe('dark');
  });

  it('uses a well-formed id as given, known or not', () => {
    const known = renderHook(() => useHostTheme('retro-dark', 'dark'));
    expect(known.result.current.id).toBe('retro-dark');
    expect(known.result.current.anchorProps).toEqual({
      'data-canopy-host-root': '',
      'data-floating-menu-container': '',
      'data-theme': 'retro-dark',
    });

    const unknown = renderHook(() => useHostTheme('solarized', 'light'));
    expect(unknown.result.current.id).toBe('solarized');
  });
});

describe('useHostTheme anchor', () => {
  it('puts the anchor attributes on the root element', () => {
    const { getByTestId } = render(<Root raw="desy-light" mode="light" />);
    const anchor = getByTestId('anchor');
    expect(anchor.getAttribute('data-canopy-host-root')).toBe('');
    expect(anchor.getAttribute('data-floating-menu-container')).toBe('');
    expect(anchor.getAttribute('data-theme')).toBe('desy-light');
  });

  it('sets the document theme to the mode, never the id', () => {
    const { rerender } = render(<Root raw="retro-dark" mode="dark" />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    rerender(<Root raw="retro-light" mode="light" />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it("works on the anchor's own document, not the one that rendered it", () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const frameDoc = frame.contentDocument!;
    const frameWin = frameDoc.defaultView!;
    markHosted(frameDoc);
    const frameRead = vi.spyOn(frameWin, 'getComputedStyle');
    const openerRead = vi.spyOn(window, 'getComputedStyle');
    const warn = spyWarn();

    render(<PortalRoot target={frameDoc.body} mode="light" />);

    expect(frameDoc.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(frameRead).toHaveBeenCalledTimes(1);
    expect(openerRead).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('useHostTheme contract marker', () => {
  it('stays silent and reads nothing in a standalone document', () => {
    const read = vi.spyOn(window, 'getComputedStyle');
    const warn = spyWarn();
    render(<Root raw={null} mode="dark" />);
    expect(read).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['1', '1.4', ' 1 '])('accepts contract version %j without a warning', (contract) => {
    markHosted();
    const warn = spyWarn();
    render(<Root raw="retro-dark" mode="dark" contract={contract} />);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once when a hosted document declares no contract version', () => {
    markHosted();
    const warn = spyWarn();
    const { getByTestId } = render(<Root raw="retro-dark" mode="dark" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('expected 1.x');
    // The theme still applies.
    expect(getByTestId('anchor').getAttribute('data-theme')).toBe('retro-dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it.each(['2', '2.1', '10', '0.9'])('warns once for contract version %s', (contract) => {
    markHosted();
    const warn = spyWarn();
    const { getByTestId } = render(<Root raw="retro-dark" mode="dark" contract={contract} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(`version ${contract}`);
    expect(warn.mock.calls[0]![0]).toContain('expected 1.x');
    expect(getByTestId('anchor').getAttribute('data-theme')).toBe('retro-dark');
  });

  it('reads the marker once per mount, across re-renders and mode changes', () => {
    markHosted();
    const read = vi.spyOn(window, 'getComputedStyle');
    const warn = spyWarn();
    const { rerender } = render(<Root raw="retro-dark" mode="dark" contract="2" />);
    rerender(<Root raw="retro-light" mode="light" contract="2" />);
    rerender(<Root raw="retro-dark" mode="dark" contract="2" />);
    expect(read).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns once under StrictMode', () => {
    markHosted();
    const warn = spyWarn();
    render(
      <StrictMode>
        <Root raw="retro-dark" mode="dark" contract="2" />
      </StrictMode>
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not read the marker once the host marker was dropped', () => {
    // applyHostSheetFallback removed `data-canopy-host` before mount.
    const read = vi.spyOn(window, 'getComputedStyle');
    const warn = spyWarn();
    render(<Root raw="retro-dark" mode="dark" contract="2" />);
    expect(read).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
