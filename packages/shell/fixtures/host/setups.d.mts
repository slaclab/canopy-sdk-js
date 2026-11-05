// Types of setups.mjs, written by hand: the module is plain JavaScript so that Node, Playwright
// and a script outside any TypeScript project can load it as it is.

/** The part of a Playwright Locator the setups and the probe runner use. */
export interface LocatorLike {
  first(): LocatorLike;
  click(options?: object): Promise<void>;
  hover(options?: object): Promise<void>;
  focus(options?: object): Promise<void>;
  fill(value: string, options?: object): Promise<void>;
  press(key: string, options?: object): Promise<void>;
  waitFor(options?: object): Promise<void>;
  isDisabled(options?: object): Promise<boolean>;
  count(): Promise<number>;
  locator(selector: string): LocatorLike;
  // Typed as loosely as it gets on purpose: Playwright's own `evaluate` is generic over the
  // element and the argument, and only parameters of type `never` let a real Locator be passed
  // where this interface is asked for. The runner calls it, and so does the one setup that has
  // to run in the page (`hold-tab-drag` and its release).
  evaluate(pageFunction: never, arg?: never): Promise<unknown>;
}

/** The part of a Playwright Page that a Frame has too; either can be passed. */
export interface PageLike {
  locator(selector: string): LocatorLike;
  getByRole(role: never, options?: { name?: string | RegExp }): LocatorLike;
  url(): string;
  goto(url: string, options?: object): Promise<unknown>;
}

/** What a setup is told about the row it prepares. */
export interface SetupContext {
  /** The row's own element: the first match of its selector. */
  locator: LocatorLike;
  /** The theme id the page was opened with. */
  theme?: string;
  /**
   * Opens a page path of hostProbes.json. Supply it where the app is served under a prefix;
   * the default is `page.goto(path)`.
   */
  goto?: (path: string) => Promise<unknown>;
}

export type Setup = (page: PageLike, ctx: SetupContext) => Promise<void>;

/** The values a row's `setup` array may hold. */
export type SetupName =
  | 'select-first-nav-row'
  | 'open-write-dialog'
  | 'hover'
  | 'focus'
  | 'hover-action'
  | 'open-properties'
  | 'select-first-outline-row'
  | 'open-outline'
  | 'open-section-axes'
  | 'open-section-display'
  | 'open-more'
  | 'open-screen-tree-menu'
  | 'open-insight-overflow'
  | 'open-trace-tab'
  | 'open-save-view-dialog'
  | 'open-view-menu'
  | 'dock-second-tile'
  | 'hold-tab-drag';

/** The page of the write-dialog rows; `{theme}` is the theme id. */
export declare const WRITE_PROBE_PAGE: string;

/** A PV the Trace hare mock never answers, so its metadata check stays pending. */
export declare const HOLD_PV: string;

/** The query the stand-in Trace reports when the opened tab has none, so there is a view to save. */
export declare const SAVE_VIEW_QUERY: string;

/**
 * Conditions that must still hold when a row's expectations have been read, by setup name, and
 * the release of a state a setup holds. The probe runner runs them as the last step of a row.
 */
export declare const postconditions: Partial<Record<SetupName, (page: PageLike) => Promise<void>>>;

declare const selectFirstNavRow: Setup;
declare const openWriteDialog: Setup;
declare const hover: Setup;
declare const focus: Setup;
declare const hoverAction: Setup;
declare const openProperties: Setup;
declare const selectFirstOutlineRow: Setup;
declare const openOutline: Setup;
declare const openSectionAxes: Setup;
declare const openSectionDisplay: Setup;
declare const openMore: Setup;
declare const openScreenTreeMenu: Setup;
declare const openInsightOverflow: Setup;
declare const openTraceTab: Setup;
declare const openSaveViewDialog: Setup;
declare const openViewMenu: Setup;
declare const dockSecondTile: Setup;
declare const holdTabDrag: Setup;

export {
  selectFirstNavRow as 'select-first-nav-row',
  openWriteDialog as 'open-write-dialog',
  hover as 'hover',
  focus as 'focus',
  hoverAction as 'hover-action',
  openProperties as 'open-properties',
  selectFirstOutlineRow as 'select-first-outline-row',
  openOutline as 'open-outline',
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
