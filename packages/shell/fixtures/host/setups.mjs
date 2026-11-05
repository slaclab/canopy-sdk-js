// The page setups the probe rows of hostProbes.json name: what has to happen on a page before a
// row's element exists or is in the state the row probes. Every setup lives here once, so the
// viewer specs, the Trace specs and the stack probe drive a page the same way.
//
// Plain ESM, duck-typed on the part of Playwright's API that a Page and a Frame share (`locator`,
// `getByRole`, `url`, `goto`), so this package needs no Playwright dependency and a setup also
// runs inside an iframe. Code that has to run in the page goes through a locator's `evaluate`,
// which both have too. The exports are string-named after the values of a row's `setup` array.
//
// Test fixture, not runtime API. The setups drive the DOM of canopy-screen-runtime (the viewer's
// tab strip and dock) and react-trace (the `.wb-sidebar` workbench, the actions bar), open their
// pages (`/embed/drafts/write-probe`) and rely on their mocks (`SR:HOLD`, a PV Trace's hare mock
// never answers). Those selectors, pages and PVs are a contract with those repos: a change to
// that DOM needs the matching change here.

/**
 * @typedef {object} LocatorLike
 * @property {() => LocatorLike} first
 * @property {(options?: object) => Promise<void>} click
 * @property {(options?: object) => Promise<void>} hover
 * @property {(options?: object) => Promise<void>} focus
 * @property {(value: string, options?: object) => Promise<void>} fill
 * @property {(key: string, options?: object) => Promise<void>} press
 * @property {(options?: object) => Promise<void>} waitFor
 * @property {(options?: object) => Promise<boolean>} isDisabled
 * @property {() => Promise<number>} count
 * @property {(selector: string) => LocatorLike} locator
 * @property {(pageFunction: Function, arg?: unknown) => Promise<unknown>} evaluate Runs
 *   `pageFunction(element, arg)` in the page; the synthetic tab drag needs it.
 */

/**
 * @typedef {object} PageLike
 * @property {(selector: string) => LocatorLike} locator
 * @property {(role: string, options?: object) => LocatorLike} getByRole
 * @property {() => string} url
 * @property {(url: string, options?: object) => Promise<unknown>} goto
 */

/**
 * @typedef {object} SetupContext
 * @property {LocatorLike} locator The row's own element (first match of its selector).
 * @property {string} [theme] The theme id the page was opened with.
 * @property {(path: string) => Promise<unknown>} [goto] Opens a page path of hostProbes.json;
 *   supply it where the app is served under a prefix. Default: `page.goto(path)`.
 */

/** The page of the write-dialog rows; `{theme}` is the theme id. */
export const WRITE_PROBE_PAGE = '/embed/drafts/write-probe?embedded=true&theme={theme}';

/** A PV the Trace hare mock never answers, so its metadata check stays pending. */
export const HOLD_PV = 'SR:HOLD';

const TAB_STRIP = '.tab-strip';
const DOCKED_TAB = `${TAB_STRIP} [role=tab][data-docked=true]`;
const UNDOCKED_TAB = `${TAB_STRIP} [role=tab][data-docked=false]`;
/** The dock root while it lists two or more docked keys (`data-docked` is a JSON array). */
const TWO_TILES = `[data-testid=workspace-dock][data-docked*='","']`;

/** The workbench sidebar of a tool (react-trace `src/workbench/`) and its one pane. */
const SIDEBAR = '.wb-sidebar';
const PANE = '.wb-sidebar__pane--properties';
/** The properties panel inside the pane: what every panel row reads inside. */
const PANEL = `${PANE} .wb-panel`;
/** A card's head in the panel's top block (Trace curves, Correlation PVs, Waveform signals). */
const CARD_HEAD = `${PANEL} .wb-card__head`;
/** A plot-wide section of the panel (`data-section` is its id: acquisition, axes, display, statistics). */
const PLOT_SECTION = (/** @type {string} */ id) => `${PANEL} .wb-plot-section[data-section=${id}]`;
/** The tool's actions bar, and one of its actions (a Carbon IconButton). */
const ACTIONS_BAR = '[data-testid=actions-bar]';
const ACTION = `${ACTIONS_BAR} .cds--btn--icon-only`;

/** The tile edge `hold-tab-drag` holds the drag at. */
const HOLD_EDGE = 'bottom';
/** How long `hold-tab-drag` repeats dragover before it gives up on the drop highlight. */
const HOLD_HIGHLIGHT_BUDGET_MS = 1000;

/**
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function selectFirstNavRow(page) {
  await page.locator('.nav-tree__row').first().click();
  await page.locator('.nav-tree__row--selected').first().waitFor();
}

/**
 * Opens the write-confirmation dialog and stops there: it never confirms, so no PV is written.
 * The page must run against a hare backend that reports `PROBE:WRITE` writable.
 *
 * @param {PageLike} page
 * @param {SetupContext} ctx
 * @returns {Promise<void>}
 */
async function openWriteDialog(page, ctx) {
  if (!new URL(page.url(), 'http://probe.invalid').pathname.endsWith('/embed/drafts/write-probe')) {
    const path = WRITE_PROBE_PAGE.replaceAll('{theme}', ctx.theme ?? 'light');
    await (ctx.goto ? ctx.goto(path) : page.goto(path));
  }
  const input = page.locator('.carbon-pv-input input').first();
  await input.fill('1');
  await input.press('Enter');
  await page.locator('[data-testid=canopy-write-dialog]').waitFor();
}

/**
 * @param {PageLike} _page
 * @param {SetupContext} ctx
 * @returns {Promise<void>}
 */
async function hover(_page, ctx) {
  await ctx.locator.hover();
}

/**
 * @param {PageLike} _page
 * @param {SetupContext} ctx
 * @returns {Promise<void>}
 */
async function focus(_page, ctx) {
  await ctx.locator.focus();
}

/**
 * Hovers the first action of the actions bar until its tooltip shows.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function hoverAction(page) {
  await page.locator(ACTION).first().hover();
  await page.locator(`${ACTIONS_BAR} .cds--popover-content`).first().waitFor();
}

/**
 * Shows the tool's properties panel: a collapsed sidebar (the 32 px rail) is expanded through its
 * target; a panel already showing is left alone, so the step is idempotent and composes after a
 * setup that revealed it.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openProperties(page) {
  await page.locator(SIDEBAR).first().waitFor();
  const rail = page.locator('.wb-sidebar__rail-target[data-pane=properties]');
  if ((await rail.count()) > 0) await rail.first().click();
  await page.locator(PANEL).first().waitFor();
}

/**
 * Opens the first card of the panel's top block (in Trace the first curve), a user selection; it
 * waits until that card's body shows. A card already open is left open.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function selectFirstOutlineRow(page) {
  await openProperties(page);
  const open = page.locator(`${PANEL} .wb-card--open`);
  if ((await open.count()) === 0) {
    await page.locator(`${CARD_HEAD} .wb-outline-row__name`).first().click();
  }
  await page.locator(`${PANEL} .wb-card--open .wb-card__body`).first().waitFor();
}

/**
 * The setup that opens the plot-wide section `id` of the panel, clicking its header only when it
 * is closed. The runner looks setups up by name, so each section a row needs is one export below.
 *
 * @param {string} id
 * @returns {(page: PageLike) => Promise<void>}
 */
function openSection(id) {
  const head = `${PLOT_SECTION(id)} > .wb-plot-section__head`;
  return async (page) => {
    await openProperties(page);
    const closed = page.locator(`${head}[aria-expanded=false]`);
    if ((await closed.count()) > 0) await closed.first().click();
    await page
      .locator(`${PLOT_SECTION(id)} > .wb-plot-section__body`)
      .first()
      .waitFor();
  };
}

const openSectionAxes = openSection('axes');
const openSectionDisplay = openSection('display');

/**
 * Opens every closed "More" disclosure the panel shows, so a row can read a field kept there.
 * Runs after the setup that opened the card or section holding it.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openMore(page) {
  const closed = page.locator(`${PANEL} .wb-block__more-toggle[aria-expanded=false]`);
  // Each click opens the first one still closed; the count bounds the loop.
  const count = await closed.count();
  for (let i = 0; i < count; i += 1) await closed.first().click();
  await page.locator(`${PANEL} .wb-block__more-body`).first().waitFor();
}

/**
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openScreenTreeMenu(page) {
  await page.locator('.screen-tree [role=treeitem]').first().click({ button: 'right' });
  await page.locator('.cds--menu').first().waitFor();
}

/**
 * The Save-view button renders only on a tool tab.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openTraceTab(page) {
  await page.locator('.screen-tree [data-tool=trace]').first().click();
  await page.locator('.save-view__button').first().waitFor();
}

/** The Trace frame of a tool tab, the Save-view button, and the open dialog's box. */
const TRACE_FRAME = 'iframe.workspace-trace';
const SAVE_VIEW_BUTTON = '.save-view__button';
const OPEN_MODAL = '.cds--modal.is-visible .cds--modal-container';
/** The query the stand-in Trace reports when the opened tab has none, so there is a view to save. */
export const SAVE_VIEW_QUERY = 'pv=PROBE:SAVE&range=-1h';

/**
 * Asks the stand-in Trace in `frame` to report `query` as its view; runs in the page, on the
 * iframe. Waits for the frame's hook (`__postQuery`) to be installed.
 *
 * @param {Element} frame
 * @param {string} query
 * @returns {Promise<string | null>} Why the query was not reported, or null when it was.
 */
async function postTraceQueryInPage(frame, query) {
  const view = /** @type {any} */ (frame.ownerDocument.defaultView);
  const deadline = view.performance.now() + 5000;
  for (;;) {
    const inner = /** @type {any} */ (frame).contentWindow;
    if (inner && typeof inner.__postQuery === 'function') {
      inner.__postQuery(query);
      return null;
    }
    if (view.performance.now() > deadline) return 'the Trace frame never offered __postQuery';
    await new Promise((r) => view.setTimeout(r, 50));
  }
}

/**
 * Opens the Save-view dialog of a Trace tab (whose primary button reads Save, or Replace over
 * a view of the same name) and stops there: it never saves. The button is disabled while the
 * tab has no query, so a stand-in Trace is asked to report one first.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openSaveViewDialog(page) {
  await openTraceTab(page);
  const button = page.locator(SAVE_VIEW_BUTTON).first();
  if (await button.isDisabled()) {
    const failure = await page
      .locator(TRACE_FRAME)
      .first()
      .evaluate(postTraceQueryInPage, SAVE_VIEW_QUERY);
    if (failure !== null) throw new Error(`open-save-view-dialog: ${failure}`);
  }
  await button.click();
  await page.locator(OPEN_MODAL).first().waitFor();
}

/**
 * Opens the context menu of the first saved view. The page needs one: the caller seeds it.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openViewMenu(page) {
  await page
    .locator('.screen-tree [data-view-id] > .nav-tree__row')
    .first()
    .click({ button: 'right' });
  await page.locator('.cds--menu-item--danger').first().waitFor();
}

/**
 * Opens Data Insight through its action, found by accessible name (the actions bar labels it
 * `Data Insight (<shortcut>)`), then the overflow menu of the insight tool.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function openInsightOverflow(page) {
  await page.getByRole('button', { name: /^Data Insight/ }).click();
  const actions = page.locator('.insight-tool__actions').first();
  await actions.waitFor();
  await actions.locator('.cds--overflow-menu').first().click();
  await page.locator('.cds--overflow-menu-options').first().waitFor();
}

/**
 * Leaves two tiles side by side, using clicks only: the Trace leaf of the tree opens a second tab
 * in the one tile, which sends the screen's tab out of the layout, and the strip's "Open in a new
 * tile" docks that tab again. The screen's tile is the focused one afterwards.
 *
 * It changes the stored dock arrangement, so a row using it cannot share a browser context with
 * rows that expect one tile.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function dockSecondTile(page) {
  await page.locator('.screen-tree [data-tool=trace]').first().click();
  const undocked = page.locator(UNDOCKED_TAB).first();
  await undocked.waitFor();
  await undocked.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in a new tile' }).click();
  await page.locator(TWO_TILES).first().waitFor();
  await page.locator('[data-testid=tile-bar-title]').first().waitFor();
}

/**
 * Starts the drag and holds it; runs in the page, on the strip tab that is dragged.
 *
 * @param {Element} source
 * @param {{ edge: string, budgetMs: number }} arg
 * @returns {Promise<string | null>} Why the drag is not held, or null when it is.
 */
async function holdTabDragInPage(source, { edge, budgetMs }) {
  const doc = source.ownerDocument;
  const view = /** @type {any} */ (doc.defaultView);
  const key = source.getAttribute('data-tab-key');
  // The tile to hold over: the first one that shows another panel.
  let content = null;
  for (const bar of doc.querySelectorAll('[data-testid="tile-bar"]')) {
    if (bar.getAttribute('data-panel-key') === key) continue;
    content = bar.closest('.dv-groupview')?.querySelector('.dv-content-container') ?? null;
    if (content) break;
  }
  if (!content) return 'no second tile to hold the drag over';
  const rect = content.getBoundingClientRect();
  const inset = 5;
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  const point = {
    left: { x: rect.x + inset, y: midY },
    right: { x: rect.x + rect.width - inset, y: midY },
    top: { x: midX, y: rect.y + inset },
    bottom: { x: midX, y: rect.y + rect.height - inset },
  }[edge];

  const dataTransfer = new view.DataTransfer();
  const at = (/** @type {{ x: number, y: number }} */ p) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer,
    clientX: p.x,
    clientY: p.y,
  });
  const sleep = (/** @type {number} */ ms) => new Promise((r) => view.setTimeout(r, ms));
  const s = source.getBoundingClientRect();
  source.dispatchEvent(
    new view.DragEvent('dragstart', at({ x: s.x + s.width / 2, y: s.y + s.height / 2 }))
  );
  // The drag shield is a render away; hit-test only once it is up.
  const shieldDeadline = view.performance.now() + 1000;
  while (doc.querySelector('.canopy-dock-overlay')?.getAttribute('data-dragging') !== 'true') {
    if (view.performance.now() > shieldDeadline) return 'the drag shield never rose';
    await sleep(16);
  }
  const target = doc.elementFromPoint(point.x, point.y);
  if (!target) return `nothing at (${point.x}, ${point.y})`;
  view.__canopyDockDrag = { source, target, dataTransfer, point, edge };

  const painted = () => {
    for (const el of doc.querySelectorAll(`.dv-drop-target-anchor.dv-drop-target-${edge}`)) {
      const r = el.getBoundingClientRect();
      if (view.getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0) {
        return true;
      }
    }
    return false;
  };
  target.dispatchEvent(new view.DragEvent('dragenter', at(point)));
  const deadline = view.performance.now() + budgetMs;
  for (;;) {
    target.dispatchEvent(new view.DragEvent('dragover', at(point)));
    await sleep(50);
    if (painted()) return null;
    if (view.performance.now() > deadline) return `no ${edge} drop highlight was painted`;
  }
}

/**
 * Ends the held drag without dropping; runs in the page, on the tab strip.
 *
 * @param {Element} strip
 * @returns {Promise<string | null>} What was wrong with the held drag, or null.
 */
async function releaseTabDragInPage(strip) {
  const doc = strip.ownerDocument;
  const view = /** @type {any} */ (doc.defaultView);
  const held = view.__canopyDockDrag;
  if (!held) return 'no drag is held';
  delete view.__canopyDockDrag;

  let painted = false;
  for (const el of doc.querySelectorAll(`.dv-drop-target-anchor.dv-drop-target-${held.edge}`)) {
    const r = el.getBoundingClientRect();
    if (view.getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0) {
      painted = true;
    }
  }

  const sleep = (/** @type {number} */ ms) => new Promise((r) => view.setTimeout(r, ms));
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer: held.dataTransfer,
    clientX: held.point.x,
    clientY: held.point.y,
  };
  held.target.dispatchEvent(new view.DragEvent('dragleave', init));
  await sleep(80);
  (held.source.isConnected ? held.source : doc).dispatchEvent(new view.DragEvent('dragend', init));

  const deadline = view.performance.now() + 1000;
  while (doc.querySelector('.canopy-dock-overlay')?.getAttribute('data-dragging') === 'true') {
    if (view.performance.now() > deadline) return 'the drag shield stayed up after the release';
    await sleep(16);
  }
  return painted ? null : 'the drop highlight was gone; the row was read too late';
}

/**
 * Drags the first docked strip tab over an edge of the other tile and holds it there, so the
 * drop highlight stays painted. Starts from the two tiles of `dock-second-tile`.
 *
 * Playwright's mouse never raises HTML5 drag-and-drop, so the gesture is synthetic and runs in
 * the page, the same sequence as the viewer's e2e helper (`holdDrag` of dockHelpers.ts):
 * `dragstart` on the tab with one shared DataTransfer, then, once the overlay's drag shield is
 * up, `dragenter` and a `dragover` every 50 ms on whatever `elementFromPoint` returns 5 px inside
 * the tile's edge, until the highlight is painted. `postconditions['hold-tab-drag']` releases it.
 *
 * @param {PageLike} page
 * @returns {Promise<void>}
 */
async function holdTabDrag(page) {
  await page.locator(TWO_TILES).first().waitFor();
  const failure = await page
    .locator(DOCKED_TAB)
    .first()
    .evaluate(holdTabDragInPage, { edge: HOLD_EDGE, budgetMs: HOLD_HIGHLIGHT_BUDGET_MS });
  if (failure !== null) throw new Error(`hold-tab-drag: ${failure}`);
}

/**
 * Conditions that must still hold when a row's expectations have been read, by setup name, and
 * the release of a state a setup holds. The probe runner runs them as the last step of a row.
 *
 * @type {Record<string, (page: PageLike) => Promise<void>>}
 */
export const postconditions = {
  // The held drag is released without a drop (dragleave, then dragend on the tab), so the two
  // tiles stay as they were. A highlight that was gone by now means the row read nothing.
  'hold-tab-drag': async (page) => {
    const failure = await page.locator(TAB_STRIP).first().evaluate(releaseTabDragInPage);
    if (failure !== null) throw new Error(`hold-tab-drag: ${failure}`);
  },
};

export {
  selectFirstNavRow as 'select-first-nav-row',
  openWriteDialog as 'open-write-dialog',
  hover as 'hover',
  focus as 'focus',
  hoverAction as 'hover-action',
  openProperties as 'open-properties',
  openProperties as 'open-outline',
  selectFirstOutlineRow as 'select-first-outline-row',
  openSectionAxes as 'open-section-axes',
  openSectionDisplay as 'open-section-display',
  openMore as 'open-more',
  openScreenTreeMenu as 'open-screen-tree-menu',
  openInsightOverflow as 'open-insight-overflow',
  openTraceTab as 'open-trace-tab',
  openSaveViewDialog as 'open-save-view-dialog',
  openViewMenu as 'open-view-menu',
  dockSecondTile as 'dock-second-tile',
  holdTabDrag as 'hold-tab-drag',
};
