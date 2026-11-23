/**
 * True when a marked host sheet did not deliver any rule: the link never
 * produced a sheet (404, blocked, still pending) or the sheet is empty.
 */
function isDead(link: HTMLLinkElement): boolean {
  try {
    return !link.sheet || link.sheet.cssRules.length === 0;
  } catch {
    // Reading `cssRules` of a cross-origin sheet throws a SecurityError. The
    // throw itself proves the sheet loaded, so it counts as alive.
    return false;
  }
}

/**
 * Drops the host styling marker when a host stylesheet failed to load.
 *
 * A host page marks its stylesheets with `link[data-canopy-host-sheet]` and
 * the document with `data-canopy-host` on `<html>`, which switches the app
 * from its own look to the host's tokens. If any marked sheet is missing or
 * empty those tokens are undefined, so the marker is removed and the app
 * falls back to its standalone look. Without a marked link the document is
 * left untouched.
 *
 * Call it once the document's stylesheets have settled (after `load`).
 *
 * @param doc - Document to check; defaults to the global `document`. Pass a
 *   popup's document for detached windows.
 */
export function applyHostSheetFallback(doc: Document = document): void {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[data-canopy-host-sheet]'));
  const dead = links.filter(isDead);
  if (dead.length === 0) return;

  delete doc.documentElement.dataset.canopyHost;
  const hrefs = dead.map((link) => link.href).join(', ');
  console.warn(`canopy: host stylesheet did not load (${hrefs}); using the standalone theme`);
}
