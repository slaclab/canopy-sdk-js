import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { ColorMode } from './themeStore.js';

/** The shape of a host theme id: lower-case letters, digits and hyphens, at most 40 characters. */
export const HOST_THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Major version of the host contract this shell is written against. */
const CONTRACT_MAJOR = '1';

/**
 * The colour mode a theme id stands for: `light` and every `*-light` id are
 * light, everything else is dark.
 */
export function modeFromThemeId(id: string): ColorMode {
  return id === 'light' || id.endsWith('-light') ? 'light' : 'dark';
}

/** Attributes the anchor element of a hosted document root carries. */
export interface HostThemeAnchorProps {
  'data-canopy-host-root': '';
  'data-floating-menu-container': '';
  'data-theme': string;
}

/**
 * The theme a hosted document root renders with, and the attributes that make
 * its root element the anchor a host stylesheet styles.
 *
 * `raw` is the theme id a host asked for, untrusted. It is used only when it
 * has the shape of `HOST_THEME_ID`; anything else, including no id at all,
 * falls back to `mode`, so the raw string never reaches the DOM unchecked. An
 * id the app does not know still passes: the host's sheet decides what it means.
 *
 * Spread `anchorProps` on the root element and attach `anchorRef` to it. After
 * mount the hook sets `data-theme` on `<html>` of the anchor's own document to
 * `mode` (a root rendered into a detached window follows that window, not the
 * opener). While that document still carries the host marker
 * (`data-canopy-host` on `<html>`), it also reads the sheet's
 * `--canopy-host-contract` version from the anchor, once per mount, and warns
 * once when the version is missing or has a different major. The theme applies
 * either way.
 *
 * @param raw - Theme id requested by the host, or `null` when there is none.
 * @param mode - Colour mode of the app; the fallback id and the document theme.
 */
export function useHostTheme<E extends HTMLElement = HTMLElement>(
  raw: string | null,
  mode: ColorMode
): { id: string; anchorRef: RefObject<E | null>; anchorProps: HostThemeAnchorProps } {
  // `RegExp.test` coerces its argument, so `null` would match as 'null'.
  const id = raw !== null && HOST_THEME_ID.test(raw) ? raw : mode;
  const anchorRef = useRef<E | null>(null);
  const markerRead = useRef(false);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const doc = el.ownerDocument;
    doc.documentElement.dataset.theme = mode;

    if (markerRead.current) return;
    markerRead.current = true;
    if (doc.documentElement.dataset.canopyHost === undefined) return;

    const version = (doc.defaultView ?? window)
      .getComputedStyle(el)
      .getPropertyValue('--canopy-host-contract')
      .trim();
    if (version === '') {
      console.warn(
        `canopy: host stylesheet declares no contract version; expected ${CONTRACT_MAJOR}.x`
      );
    } else if (version.split('.')[0] !== CONTRACT_MAJOR) {
      console.warn(
        `canopy: host stylesheet declares contract version ${version}; expected ${CONTRACT_MAJOR}.x`
      );
    }
  }, [mode]);

  return {
    id,
    anchorRef,
    anchorProps: {
      'data-canopy-host-root': '',
      'data-floating-menu-container': '',
      'data-theme': id,
    },
  };
}
