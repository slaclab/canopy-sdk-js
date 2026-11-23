# @slaclab/canopy-shell

The standard chrome for Canopy web apps, in the SLAC look:

- **`AppHeader`**: "SLAC" prefix and product name in SLAC red. The header
  follows the page theme. Built-in theme toggle, bug report and help actions.
- **Color mode**: a persisted light/dark store mapped to Carbon **g10 / g100**,
  with `ColorModeTheme` as the one-line app root.
- **Layout**: `AppShell` (fixed header, side rail, scrolling main) and
  `SideNavRail` (collapsible, works with any router).
- **Feedback**: `ToastProvider`/`useToast`, `ConfirmProvider`/`useConfirm`,
  and `ErrorBoundary`/`ErrorFallback`.

## Install

Peer dependencies: `react`, `react-dom` (^19), `@carbon/react` (^1.90),
`@carbon/icons-react` (^11.50).

Load Carbon's CSS first, then the shell's CSS:

```ts
import '@carbon/styles/css/styles.css';
import '@slaclab/canopy-shell/styles.css';
```

## Quick start (multi-page app)

```tsx
// main.tsx, before the first render
import { configureColorMode } from '@slaclab/canopy-shell';
configureColorMode({ storageKey: 'badger.theme', defaultMode: 'light' });
```

```tsx
// root layout
import { useState } from 'react';
import {
  AppHeader,
  AppShell,
  ColorModeTheme,
  ConfirmProvider,
  ErrorBoundary,
  SideNavRail,
  ToastProvider,
} from '@slaclab/canopy-shell';

export function Root() {
  const [navOpen, setNavOpen] = useState(true);
  const pathname = usePathname(); // from your router, same form as the item hrefs
  return (
    <ColorModeTheme>
      <ToastProvider>
        <ConfirmProvider>
          <AppShell
            header={
              <AppHeader
                productName="Badger"
                href="/"
                nameAs={HeaderLink}
                fixed
                menu={{ open: navOpen, onToggle: () => setNavOpen((o) => !o) }}
                actions={<ConnectionStatus />}
                themeToggle
                bugReportUrl="https://example.org/bug-form"
                helpUrl="https://example.org/help"
              />
            }
            sideNav={
              <SideNavRail
                items={NAV_ITEMS}
                expanded={navOpen}
                activeHref={pathname}
                onNavigate={(href) => navigateTo(href)}
              />
            }
            sideNavExpanded={navOpen}
            banners={<ApiUnreachableBanner />}
          >
            <ErrorBoundary resetKeys={[pathname]}>
              <Outlet />
            </ErrorBoundary>
          </AppShell>
        </ConfirmProvider>
      </ToastProvider>
    </ColorModeTheme>
  );
}
```

A single-screen app (react-trace style) skips `AppShell`. It renders an in-flow
`<AppHeader>` (the default, `fixed={false}`) at the top of its own flex column.

## Color mode

| Export                                                        | What it does                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `useColorMode()`                                              | `{ colorMode, toggle, setColorMode, carbonTheme }`, re-rendering on change                                                         |
| `getColorMode()` / `setColorMode(m)` / `toggleColorMode()`    | Imperative access                                                                                                                  |
| `CARBON_THEME`                                                | `{ light: 'g10', dark: 'g100' }`, the SLAC standard                                                                                |
| `ColorModeTheme`                                              | `<Theme theme={CARBON_THEME[colorMode]}>` that follows the store; takes the usual `div` props                                      |
| `configureColorMode({ storageKey, defaultMode, legacyKeys })` | Call once at bootstrap, before the first render                                                                                    |
| `syncDocumentColorMode(mode)`                                 | Sets `data-theme` and `cds--g10`/`cds--g100` on `<html>`. `useColorMode` already does this; exported for apps with their own store |

How the store behaves:

- **Persistence.** The mode is saved in `localStorage` under `storageKey`
  (default `canopy.theme`). The store reads it lazily on first use, not at
  import time. Every storage call is wrapped in try/catch, so private mode or
  sandboxed iframes don't break the app.
- **`defaultMode`** is used when nothing is stored. The default stays `'dark'`
  for 0.1 compatibility. Squirrel and Badger pass `'light'`.
- **`legacyKeys`** migrate an earlier per-app key once. The first valid value
  is copied to `storageKey`, e.g.
  `configureColorMode({ storageKey: 'trace.theme' })` or
  `{ storageKey: 'canopy.theme', legacyKeys: ['squirrel-color-mode'] }`.
- **`<html>` sync.** The store mirrors the mode onto `<html>` as
  `data-theme="light|dark"`, for plain CSS. It also sets the Carbon
  `cds--g10`/`cds--g100` class, so content portaled outside the app's
  `<Theme>` (menus, tooltips, toasts) gets the right tokens.
- **Carbon-free entry.** `@slaclab/canopy-shell/color-mode` exports the store
  alone (everything above except `ColorModeTheme`), without loading
  `@carbon/react`. Libraries that only follow the mode, such as
  `@slaclab/canopy-charts`, import it from there. It is the same module as
  the root entry's, so both share one store.

## AppHeader

```tsx
<AppHeader
  productName="Squirrel"
  context="LCLS" // renders "Squirrel · LCLS"
  href="/"
  fixed
  menu={{ open, onToggle }}
  actions={
    <>
      {instanceSwitcher}
      {adminToggle}
    </>
  }
  themeToggle
  bugReportUrl="https://example.org/bug-form"
  onHelp={openDocsWindow}
/>
```

| Prop                           | Default           | Notes                                                                                                                         |
| ------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `productName`                  | —                 | The product name. Also the banner landmark's `aria-label`                                                                     |
| `prefix`                       | `'SLAC'`          | Carbon prefix slot; `''` hides it                                                                                             |
| `brandColor`                   | `true`            | Prefix and name in SLAC red (`--canopy-brand`); `false` keeps Carbon's header text color                                      |
| `context`                      | —                 | Appended as ` · {context}` (instance or deployment)                                                                           |
| `href`                         | `'#'`             | Name link target                                                                                                              |
| `nameAs`                       | `<a>`             | Router link component for the name (Carbon `as`); see [Router links](#router-links)                                           |
| `theme`                        | `'inherit'`       | Follows the surrounding `<Theme>`. `'white' \| 'g10' \| 'g90' \| 'g100'` wraps the bar in that theme                          |
| `fixed`                        | `false`           | `true` = Carbon's fixed header (content needs a 3rem offset; `AppShell` handles it). `false` = in-flow (`position: relative`) |
| `skipToContent`                | `'#main-content'` | Skip-link target, or `false`. `AppShell`'s `<main>` has that id; without `AppShell`, render one or pass `false`               |
| `menu`                         | —                 | `{ open, onToggle, openLabel?, closeLabel? }` renders an always-visible hamburger ("Open menu" / "Close menu")                |
| `actions`                      | —                 | App `HeaderGlobalAction`s, rendered before the standard actions                                                               |
| `themeToggle`                  | `false`           | `true` or `{ shortcut: 'Alt+T' }` (appends " (Alt+T)" to the label; the app binds the key)                                    |
| `bugReportUrl` / `onReportBug` | —                 | "Report a bug" action; the URL opens in a new tab (`noopener`); the handler wins                                              |
| `helpUrl` / `onHelp`           | —                 | Help action; same rules                                                                                                       |
| `helpLabel`                    | `'Help'`          | Label of the help action                                                                                                      |
| `children`                     | —                 | Middle slot between the name and the global bar (status text, counts)                                                         |
| `className`                    | —                 | Extra class on the Carbon `<Header>`                                                                                          |
| `title`, `toolbar`             | —                 | **Deprecated** aliases of `productName` and `actions`                                                                         |

The trailing actions always come in this order: **app actions → theme toggle →
report bug → help**.

The theme toggle shows **Sun** in dark mode, labelled "Switch to light mode",
and **Moon** in light mode, labelled "Switch to dark mode". It is also exported
as `ThemeToggleAction` for custom bars.

**Branding.**

- The prefix and name use `var(--canopy-brand)`: SLAC red `#901515` (the same
  value as squirrel) on light headers, and Carbon red-40 `#ff8389` on dark
  (g90/g100) headers. `#901515` would be only about 2:1 against the g100 header
  background, which fails WCAG AA; red-40 is about 7.6:1. An app can override
  `--canopy-brand` itself, or pass `brandColor={false}` for Carbon's plain
  header text color.
- Header icon buttons drop their focus ring after a mouse click. Keyboard focus
  rings stay.
- Header tooltips use Carbon's inverse tokens.

### Router links

`nameAs` is rendered in place of the name's `<a>` and receives `href`,
`className` and `children`. A router whose link takes `to` (TanStack Router,
React Router) needs a small adapter:

```tsx
import type { ComponentProps } from 'react';
import { Link } from '@tanstack/react-router';

// Carbon passes `href`; TanStack's Link wants `to`, relative to the router basepath.
function HeaderLink({ href = '/', ...rest }: ComponentProps<'a'>) {
  return <Link to={href} {...rest} />;
}

<AppHeader productName="Badger" href="/" nameAs={HeaderLink} />;
```

Without `nameAs`, the name is a plain anchor. Clicking it reloads the page.

## Layout

### AppShell

```tsx
<AppShell header={...} sideNav={...} sideNavExpanded={open} banners={...} mainId="main-content">
  {page}
</AppShell>
```

- **Header.** Pinned to the top (3rem). Pass `fixed` anyway, so the header
  is also correct outside the shell.
- **Side rail.** When present, `<main>` is offset by the rail width: 16rem
  expanded, 3rem collapsed. The offset animates with the rail (0.11s).
- **`<main>`.** Has `id={mainId}` (default `main-content`, the header skip-link
  target) and `tabIndex={-1}`. It fills the rest of the viewport.
- **Banners.** Stack at the top of `<main>` at full width. Carbon
  notifications inside them are squared off.
- **Scrolling.** The page content scrolls inside `<main>`, not the document.

### SideNavRail

```tsx
import { ChartLine, Dashboard, Settings } from '@carbon/icons-react';
import type { NavItem } from '@slaclab/canopy-shell';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // '' or e.g. '/badger'
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: `${BASE}/`, icon: Dashboard },
  { id: 'runs', label: 'Runs', href: `${BASE}/runs`, icon: ChartLine },
  {
    id: 'settings',
    label: 'Settings',
    href: `${BASE}/settings`,
    icon: Settings,
    section: 'footer',
  },
];

<SideNavRail
  items={NAV_ITEMS}
  expanded={open}
  activeHref={window.location.pathname} // same form as the hrefs (base path included)
  onNavigate={(href) => navigate({ to: href.slice(BASE.length) || '/' })} // router-relative
  footer={<SaveSnapshotButton compact={!open} />}
/>;
```

- **Links.** Items render as plain `<a href>`. `href` is the full path,
  including any base path, so middle-click, Ctrl/⌘-click and "open in new tab"
  work.
- **`onNavigate(href, event)`.** Called only for an unmodified left click, with
  the default navigation prevented; hand the path to your router here. Without
  `onNavigate`, the links navigate normally (full page load).
- **Active item.** An item is active when `activeHref` equals its `href` or
  starts with `href + '/'`. If several match, the longest `href` wins. An
  `href` ending in `/`, like the `${BASE}/` home item above, matches only its
  own path, so it isn't highlighted on every page; a trailing slash on either
  side is ignored when comparing (`/badger` matches `/badger/`). Query
  strings and fragments are ignored; a leading `#` (hash routing, `#/runs`) is
  read as the path. The active link gets `aria-current="page"`.
  The matcher is exported as `findActiveNavItem(items, activeHref)`.
- **Look.** 256px expanded, 48px collapsed, a
  `--cds-layer` background, and a 3px `--cds-link-primary` left border plus
  `--cds-layer-selected` on the active item.
- **Collapsed.** Only icons show, each with a Carbon tooltip that also gives
  the link its accessible name. Items without an icon show their initial.
- **Bottom of the rail.** `section: 'footer'` items and the `footer` node sit
  here.
- **Landmark.** The rail is `<nav aria-label="Side navigation">`; `ariaLabel`
  overrides the label.

## Toasts

```tsx
const toast = useToast();
const id = toast.show({ kind: 'success', title: 'Run launched', subtitle: routine.name });
toast.show({ kind: 'error', title: 'Dial-in failed', subtitle: message }); // sticky: errors stay
toast.dismiss(id);
```

- **Stack.** Toasts are Carbon `ToastNotification`s portaled to `<body>` and
  stacked top-right, just under the header. Errors stack above the other
  kinds. The stack sits above modals.
- **`timeoutMs`.** Error toasts are sticky by default: they stay until the
  user closes them or you call `dismiss(id)`, so nobody misses a failure.
  The other kinds default to 5000 ms, or `ToastProvider defaultTimeoutMs`.
  A `timeoutMs` on the toast overrides both; `0` makes any toast sticky.
- **Closing.** The close button dismisses the toast.
- **Screen readers.** The stack's two live regions are mounted with the
  provider, before any toast, so every toast is announced: errors in an
  assertive `role="alert"` region, the other kinds in a polite
  `role="status"` region. The toasts themselves are not live regions.
- **Contrast.** Toasts use Carbon's high-contrast style by default. Set
  `ToastProvider lowContrast` for theme-following toasts.
- **Theme.** The stack takes the theme of the nearest Carbon `<Theme>`. Render
  `ToastProvider` inside `ColorModeTheme`.
- **Outside a provider.** `useToast()` throws.

## Confirm dialogs

```tsx
const confirm = useConfirm();
if (
  await confirm({
    heading: 'Delete routine?',
    body: 'This cannot be undone.',
    danger: true,
    confirmLabel: 'Delete',
  })
) {
  await deleteRoutine(id);
}
```

- **Result.** The promise resolves `true` on confirm. It resolves `false` on
  Cancel, Escape, the close button or an outside click.
- **Options.** `body` is a string (wrapped in a paragraph) or any node.
  `confirmLabel` defaults to "Confirm", `cancelLabel` to "Cancel", and `size`
  (`xs`/`sm`/`md`/`lg`) to `sm`.
- **Keyboard.** Focus starts on the primary button, and Enter confirms.
  `danger` gives a red primary button and starts focus on Cancel. In a danger
  dialog, Enter only activates the focused button and never confirms
  implicitly.
- **Several requests.** Requests queue and are shown one at a time. Each is
  a fresh dialog with its own initial focus, so a queued danger dialog still
  starts on Cancel.
- **Focus afterwards.** Focus returns to the element that opened the dialog
  (for a queue, the one that opened the first dialog).
- **Unmount.** Unmounting the provider resolves pending requests with `false`.
- **Setup.** Render `ConfirmProvider` inside `ColorModeTheme`. `useConfirm()`
  throws outside a provider.

## Error boundary

```tsx
<ErrorBoundary onError={(e) => logger.error(e)} resetKeys={[pathname]}>
  <Page />
</ErrorBoundary>

<ErrorBoundary fallback={(error, reset) => <MyPanel error={error} onRetry={reset} />}>…</ErrorBoundary>
```

- **Default fallback.** `ErrorFallback` shows a Carbon error notification with
  the message, plus **Try again** (re-renders the children) and **Reload**
  (reloads the page).
- **Resetting.** `resetKeys` reset the boundary when any value changes, so
  navigating away from a crashed page recovers.
- **Standalone use.** `ErrorFallback({ error, reset?, title? })` also works on
  its own, for example as a router error component.

## Migrating from 0.1

| 0.1                                                   | 0.2                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `<AppHeader title="X" toolbar={…}>`                   | Still compiles (deprecated). Prefer `productName` and `actions`                       |
| Header always dark (forced `g100` wrapper)            | Follows the page theme (`theme="inherit"`)                                            |
| No prefix                                             | `SLAC` prefix; name and prefix in SLAC red (`#901515`; `#ff8389` on dark headers)     |
| `.canopy-header__name { letter-spacing: 0.04em }`     | Removed (squirrel). Apps that want it (trace) keep it in their own CSS                |
| Body themes `g90` / `g10` in the README               | `g100` / `g10` via `CARBON_THEME` / `ColorModeTheme`                                  |
| Hand-rolled toggle (`Light`/`Asleep`, "Toggle theme") | `themeToggle`: Sun/Moon, "Switch to light/dark mode"                                  |
| Store read `localStorage` at import, unguarded        | Lazy and guarded; key/default configurable; `<html>` also gets `cds--g10`/`cds--g100` |
| `useColorMode()` → `{ colorMode, toggle }`            | Adds `setColorMode` and `carbonTheme` (existing fields unchanged)                     |
| Error toasts auto-dismiss after 5 s                   | Error toasts are sticky unless they set `timeoutMs`                                   |
| No skip link                                          | `AppHeader` renders a "Skip to main content" link to `#main-content` (see below)      |

**To keep the 0.1 look** (an always-dark bar with no prefix and a plain
name), for example in the screen viewer, pass
`theme="g100" prefix="" brandColor={false}`:

```tsx
<AppHeader title="Canopy Screens" theme="g100" prefix="" brandColor={false} />
```

**The skip link needs a target.** `AppHeader` now renders Carbon's "Skip to
main content" link pointing at `#main-content`. `AppShell` provides that id on
its `<main>`. An app that renders `AppHeader` without `AppShell` (react-trace
style) must either give its main content element `id="main-content"` (and
`tabIndex={-1}`, so it can take focus), point the link elsewhere with
`skipToContent="#my-content"`, or pass `skipToContent={false}`; otherwise
the link goes nowhere.

**To adopt the standard**, do three things:

- wrap the app in `<ColorModeTheme>` (the body becomes g10/g100)
- add `themeToggle`, `bugReportUrl` and `helpUrl`/`onHelp`
- call `configureColorMode({ storageKey: '<app>.theme' })` at bootstrap,
  adding `legacyKeys` if the app stored its choice under another key

## Styling

- **Tokens only.** All colors are Carbon `--cds-*` tokens, except
  `--canopy-brand` and the host contract's `--canopy-*` variables (see
  [Host theme contract v1](#host-theme-contract-v1)).
- **Layout variables.** Set on `.canopy-shell`: `--canopy-header-height`
  (3rem), `--canopy-rail-expanded-width` (16rem), `--canopy-rail-collapsed-width`
  (3rem) and `--canopy-rail-transition` (0.11s ease).
- **Class names.** BEM, prefixed `canopy-`: `canopy-header`, `canopy-shell__*`,
  `canopy-rail__*`, `canopy-toasts`, `canopy-confirm`,
  `canopy-error-fallback`.

## Host theme contract v1

An app built on this shell can be embedded in a host page (a dashboard, a web
terminal) and take the host's fonts, colours, radii and control heights instead
of Carbon's. The host fills `--canopy-host-*` custom properties on one anchor
element per document; the app reads only those names and never the host's own.
The items below are the whole interface. An app gains nothing else from being
embedded, and a host needs to know nothing else about the app.

### Standalone guarantee

Without a host stylesheet nothing changes: every `--canopy-*` variable computes
to the Carbon value of its zone, so the app renders with Carbon defaults. The
same holds when a host stylesheet is named but fails to load (see
`applyHostSheetFallback`), and for each single name a host leaves unset, because
every read of a `--canopy-host-*` property carries the Carbon value as its
fallback.

### Versioning

A host stylesheet declares the contract version it was written for as
`--canopy-host-contract: 1` on the anchor. A 1.x release of the contract adds
names with fallbacks only, so a host written for 1.0 keeps working; renaming or
removing a name is version 2. `useHostTheme` warns once in the console when the
declared version is missing or has a different major, and applies the theme
either way.

### The names

Contract v1 has 27 names, each set by the host as `--canopy-host-<name>` and
read by the app as `--canopy-<name>`:

| Group    | Names                                                              |
| -------- | ------------------------------------------------------------------ |
| Fonts    | `font-ui`, `font-mono`                                             |
| Sizes    | `text-sm`, `text-md`, `text-lg`                                    |
| Radii    | `radius-sm`, `radius-md`                                           |
| Controls | `control-h-xs`, `control-h-sm`                                     |
| Surfaces | `bg-base`, `bg-panel`, `bg-elevated`, `bg-field`                   |
| Text     | `text-primary`, `text-secondary`, `text-muted`                     |
| Borders  | `border`, `border-strong`                                          |
| Accent   | `accent`, `on-accent`, `accent-hover`, `accent-tint`, `hover-tint` |
| Focus    | `focus`                                                            |
| Status   | `status-success`, `status-warning`, `status-error`                 |

### What the server that delivers the page does

- **The sidecar setting.** The serving app names the host stylesheets in its
  server config (for example canopy's `CANOPY_HOST_STYLESHEETS`:
  whitespace-separated relative `.css` paths); there is no URL parameter for
  it, so nothing a page visitor controls reaches the list.
- **`data-canopy-host` on `<html>`.** The gate: every host-driven rule of
  `host-contract.css` is scoped under `html[data-canopy-host]`, so a document
  without the attribute is standalone.
- **`data-canopy-host-sheet` on each `<link>`.** The marker that tells the app
  which stylesheets are the host's, so it can check that each one loaded.

### What the app puts on its root element

`useHostTheme` returns all three as `anchorProps`; they go on the one element
the host stylesheet styles.

- **`data-canopy-host-root`.** Marks the anchor: the element on which the host
  sets its `--canopy-host-*` properties and which fills the viewport with the
  host's base background.
- **`data-floating-menu-container`.** Makes Carbon render menus, tooltips and
  other floating layers inside the anchor, so they inherit its properties
  instead of landing on `<body>` outside them.
- **`data-theme`.** Carries the validated theme id, which is what a host
  stylesheet selects on to tell its themes apart.

### Files

```ts
import '@slaclab/canopy-shell/host-contract.css';
import tokens from '@slaclab/canopy-shell/tokens.json' with { type: 'json' };
import wiring from '@slaclab/canopy-shell/wiring.json' with { type: 'json' };
```

- **`host-contract.css`.** The stylesheet an app imports after Carbon's: it
  defines every `--canopy-*` variable per Carbon zone, points Carbon's own
  tokens at them, and holds the few component rules that read them.
- **`tokens.json`.** The contract as data: the version, the four Carbon zones
  and, for each of the 27 names, its Carbon value per zone and the Carbon
  tokens it drives.
- **`wiring.json`.** The map from every Carbon zone, type and layout token to
  the contract name that drives it, or to the reason it stays Carbon's.
- **`fixtures/host/*`.** Shared test data and setups (a sample host stylesheet
  and its values, the probe rows, the page setups, the expected `<link>` tail),
  exported as `./fixtures/*` so every consuming repository tests against the
  same host. Test-only: the export is for test suites, not runtime API. Its
  app rows and setups describe the DOM of canopy-screen-runtime and
  react-trace and are a contract with those repos.

`host-contract.css`, `tokens.json` and `wiring.json` are generated from the
pinned `@carbon/styles` by `pnpm run gen-tokens`; `pnpm test` fails when they
are stale.

### Helpers

All are exported from the package root.

- **`applyHostSheetFallback(doc?)`.** Removes `data-canopy-host` and warns once
  when a marked host stylesheet is missing or empty, so a 404 leaves the app in
  its standalone look instead of half-styled; call it after the document's
  `load`.
- **`useHostTheme(raw, mode)`.** Validates the theme id the host asked for,
  falls back to the app's colour mode, and returns the `id`, an `anchorRef`
  and the `anchorProps` for the root element.
- **`useChartFont(ref)`.** Returns the font family a chart's wrapper element
  computes and whether it has loaded, because canvas text does not inherit CSS.
- **`useFontsReady(family, doc)`.** Turns true once a font family has finished
  loading in a document, which is when a canvas chart should redraw.
- **`modeFromThemeId(id)`.** Maps a theme id to a colour mode: `light` and
  every `*-light` id are light, everything else is dark.
- **`HOST_THEME_ID`.** The regular expression a theme id must match
  (`/^[a-z0-9][a-z0-9-]{0,39}$/`); an id that fails it never reaches the DOM.
- **`.canopy-btn`.** The class of the shell's ghost button, defined in
  `host-contract.css`: transparent at rest, an alpha accent border on hover and
  when pressed.

```tsx
import { useColorMode, useHostTheme } from '@slaclab/canopy-shell';

function AppRoot({ hostThemeId }: { hostThemeId: string | null }) {
  const { colorMode } = useColorMode();
  const { anchorRef, anchorProps } = useHostTheme<HTMLDivElement>(hostThemeId, colorMode);

  return (
    <div ref={anchorRef} {...anchorProps}>
      {/* ...the app... */}
    </div>
  );
}
```

## Testing apps that use the shell

jsdom lacks `window.matchMedia` and `ResizeObserver`, and Carbon uses both.
Stub them in your test setup; see this package's `vitest.setup.ts`. Under
Node 25+ the same file also points `localStorage`/`sessionStorage` back at
jsdom's, because Node's own empty globals shadow them.
Components that call `useToast`/`useConfirm` need the providers in the test
render wrapper.
