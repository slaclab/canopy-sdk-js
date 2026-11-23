// The one probe runner: what a row of hostProbes.json means, as code. The viewer specs, the Trace
// specs and the stack probe import it and hold no assertion logic of their own, so a row passes
// or fails for the same reason wherever it runs.
//
// Plain ESM, duck-typed on the part of Playwright's API that a Page and a Frame share. `zoneOf`
// and the three normalisers run in the page: `checkRow` sends their source there together with
// the evaluation, so each of them must stay self-contained (no reference to anything else in
// this module).

import * as setups from './setups.mjs';

/** @typedef {import('./setups.mjs').PageLike} PageLike */
/** @typedef {import('./setups.mjs').LocatorLike} LocatorLike */

/** The marker a hosted document carries on `<html>`. */
const HOST_ATTRIBUTE = 'data-canopy-host';

/** The element a host stylesheet fills the contract on. */
const ANCHOR = '[data-canopy-host-root]';

/**
 * The Carbon zone element a probed element lives in. Every variable a row compares against is
 * resolved on it, and every reference element is appended inside it: a header keeps its own
 * nested zone, whose values differ from the anchor's.
 *
 * @param {Element} el
 * @returns {Element | null}
 */
export function zoneOf(el) {
  return el.closest('.cds--white, .cds--g10, .cds--g90, .cds--g100');
}

/**
 * The first family of a `font-family` value, without quotes or whitespace, lower-cased.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeFont(value) {
  const first = String(value).split(',')[0] ?? '';
  return first.replace(/["'\s]/g, '').toLowerCase();
}

/**
 * A colour as the browser computes it, resolved inside `zone` (so `var()` and `color-mix()`
 * see the zone's variables). An unparsable value yields `''`.
 *
 * @param {Element} zone
 * @param {string} value
 * @returns {string}
 */
export function normalizeColor(zone, value) {
  const doc = zone.ownerDocument;
  const ref = doc.createElement('span');
  ref.style.setProperty('color', String(value).trim());
  // A value the browser rejects (or an empty one) leaves the property unset.
  if (ref.style.getPropertyValue('color') === '') return '';
  zone.appendChild(ref);
  const computed = doc.defaultView.getComputedStyle(ref).color;
  ref.remove();
  return computed;
}

/**
 * A length in whole CSS pixels, resolved inside `zone`. An unparsable value yields `NaN`.
 *
 * @param {Element} zone
 * @param {string} value
 * @returns {number}
 */
export function normalizeLength(zone, value) {
  const doc = zone.ownerDocument;
  const ref = doc.createElement('div');
  ref.style.cssText =
    'position:absolute;display:block;box-sizing:content-box;margin:0;padding:0;border:0;' +
    'min-height:0;max-height:none;visibility:hidden;';
  ref.style.setProperty('height', String(value).trim());
  if (ref.style.getPropertyValue('height') === '') return Number.NaN;
  zone.appendChild(ref);
  const computed = doc.defaultView.getComputedStyle(ref).height;
  ref.remove();
  return Math.round(Number.parseFloat(computed));
}

/**
 * The evaluation of one row, run in the page on the row's element. Returns data only.
 *
 * @param {Element} el
 * @param {{ expect: Record<string, any>, pseudo: string | null, hostValues: Record<string, string>,
 *   tokens: { zones: string[], names: Record<string, { literals: Record<string, string> }> },
 *   hostAttribute: string }} arg
 */
async function evaluateRow(el, arg) {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;

  const gated = doc.documentElement.hasAttribute(arg.hostAttribute);
  const zone = zoneOf(el);
  if (zone === null) return { gated, zone: null, checks: [] };
  const zoneName = arg.tokens.zones.find((z) => zone.classList.contains(`cds--${z}`)) ?? null;
  const zoneStyle = view.getComputedStyle(zone);
  const style = view.getComputedStyle(el, arg.pseudo ?? undefined);

  const kindOf = (property) =>
    property === 'font-family'
      ? 'font'
      : /color$/.test(property) || property === 'fill'
        ? 'colour'
        : 'length';
  const norm = (kind, value) =>
    kind === 'font'
      ? normalizeFont(value)
      : kind === 'colour'
        ? normalizeColor(zone, value)
        : normalizeLength(zone, value);
  const usable = (v) => (typeof v === 'number' ? !Number.isNaN(v) : v !== '');
  const variable = (name) => zoneStyle.getPropertyValue(name).trim();

  const checks = [];
  for (const [property, target] of Object.entries(arg.expect)) {
    const kind = kindOf(property);
    const raw = style.getPropertyValue(property);
    const actual = norm(kind, raw);
    /** @type {{ property: string, actual: unknown, raw: string, comparisons: object[], skipped?: string }} */
    const check = { property, actual, raw, comparisons: [] };
    checks.push(check);
    const compare = (against, expectedRaw, left = actual) => {
      const expected = norm(kind, expectedRaw);
      check.comparisons.push({
        against,
        expected,
        expectedRaw,
        pass: usable(left) && usable(expected) && left === expected,
      });
    };

    if (target.hostOnly === true && !gated) {
      check.skipped = 'hostOnly';
    } else if (typeof target.contract === 'string') {
      const name = target.contract;
      if (!gated && target.standalone && typeof target.standalone.carbon === 'string') {
        // Standalone, Carbon paints its own token: the re-map to the contract name is gated.
        const token = `--cds-${target.standalone.carbon}`;
        compare(`var(${token})`, variable(token));
      } else {
        const resolved = variable(`--canopy-${name}`);
        compare(`var(--canopy-${name})`, resolved);
        const declared = gated && Object.hasOwn(arg.hostValues, name);
        const source = declared
          ? arg.hostValues[name]
          : (arg.tokens.names[name]?.literals[zoneName ?? ''] ?? '');
        const expected = norm(kind, source);
        const got = norm(kind, resolved);
        check.comparisons.push({
          against: declared ? `the host value of ${name}` : `the ${zoneName} literal of ${name}`,
          subject: `--canopy-${name}`,
          actual: got,
          expected,
          expectedRaw: source,
          pass: usable(got) && usable(expected) && got === expected,
        });
      }
    } else if (typeof target.carbon === 'string') {
      const token = `--cds-${target.carbon}`;
      compare(`var(${token})`, variable(token));
    } else if (typeof target.literal === 'string') {
      compare('the literal', target.literal);
    } else if (typeof target.inside === 'string') {
      // Geometry, not style: both inline edges of the element's box lie within the box of its
      // nearest ancestor matching the selector (half a pixel of rounding allowed).
      const box = el.getBoundingClientRect();
      const outer = el.parentElement ? el.parentElement.closest(target.inside) : null;
      const edges = (r) => `${Math.round(r.left)}..${Math.round(r.right)}`;
      if (outer === null) {
        check.comparisons.push({
          against: `no ancestor matches ${target.inside}`,
          subject: 'the box',
          actual: edges(box),
          expected: `within ${target.inside}`,
          pass: false,
        });
      } else {
        const o = outer.getBoundingClientRect();
        check.comparisons.push({
          against: `the inline edges of ${target.inside}`,
          subject: 'the box',
          actual: edges(box),
          expected: `within ${edges(o)}`,
          pass: box.width > 0 && box.left >= o.left - 0.5 && box.right <= o.right + 0.5,
        });
      }
    } else if (typeof target.mix === 'string') {
      if (!gated && target.standalone && typeof target.standalone.carbon === 'string') {
        // Standalone, Carbon paints its own token: the opaque replacement is gated.
        const token = `--cds-${target.standalone.carbon}`;
        compare(`var(${token})`, variable(token));
      } else {
        compare('the mix', target.mix);
      }
    } else {
      check.comparisons.push({ against: 'an unknown target', expected: null, pass: false });
    }
  }
  return { gated, zone: zoneName, checks };
}

// What `locator.evaluate` sends to the page: one function holding the helpers above by source.
// Built in Node, so a page's content security policy has no say in it.
const IN_PAGE = /** @type {(el: Element, arg: object) => Promise<any>} */ (
  new Function(
    'el',
    'arg',
    [zoneOf, normalizeFont, normalizeColor, normalizeLength]
      .map((fn) => `${fn.toString()}\n`)
      .join('') + `return (${evaluateRow.toString()})(el, arg);`
  )
);

/** @type {object | undefined} */
let tokensCache;

/**
 * The contract data of this package (`tokens.json`), read once.
 *
 * @returns {Promise<any>}
 */
async function loadTokens() {
  if (tokensCache === undefined) {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    // Resolved as a path: under jsdom the global URL is not the one Node's own modules accept.
    const here = dirname(fileURLToPath(import.meta.url));
    tokensCache = JSON.parse(await readFile(join(here, '..', '..', 'tokens.json'), 'utf8'));
  }
  return tokensCache;
}

/** A row that did not hold. `result` is what `checkRow` would have returned. */
export class ProbeFailure extends Error {
  /**
   * @param {string} message
   * @param {object} result
   */
  constructor(message, result) {
    super(message);
    this.name = 'ProbeFailure';
    this.result = result;
  }
}

/**
 * The page path a row runs on, for one theme id.
 *
 * @param {{ defaults: { page: Record<string, string> } }} probes The parsed hostProbes.json.
 * @param {{ app: string, page?: string }} row
 * @param {string} theme
 * @returns {string}
 */
export function pageFor(probes, row, theme) {
  return (row.page ?? probes.defaults.page[row.app]).replaceAll('{theme}', theme);
}

/**
 * Runs a row's setups in order.
 *
 * @param {PageLike} page
 * @param {{ selector: string, setup: string[] }} row
 * @param {{ theme?: string, goto?: (path: string) => Promise<unknown> }} [ctx]
 * @returns {Promise<void>}
 */
export async function runSetups(page, row, ctx = {}) {
  const locator = page.locator(row.selector).first();
  for (const name of row.setup) {
    const setup = /** @type {Record<string, unknown>} */ (setups)[name];
    if (typeof setup !== 'function') throw new Error(`unknown setup: ${name}`);
    await setup(page, { ...ctx, locator });
  }
}

/**
 * The value of every contract name a host stylesheet declares on the anchor, as
 * `--canopy-host-<name>` resolves there. Names the sheet leaves out are absent.
 *
 * @param {PageLike} page
 * @param {string[]} names
 * @returns {Promise<Record<string, string>>}
 */
export async function readHostValues(page, names) {
  return page
    .locator(ANCHOR)
    .first()
    .evaluate((anchor, list) => {
      const style = anchor.ownerDocument.defaultView.getComputedStyle(anchor);
      /** @type {Record<string, string>} */
      const out = {};
      for (const name of list) {
        const value = style.getPropertyValue(`--canopy-host-${name}`).trim();
        if (value !== '') out[name] = value;
      }
      return out;
    }, names);
}

const show = (/** @type {unknown} */ v) => (v === '' ? '(unparsable)' : String(v));

/**
 * Checks one row against the page as it stands (run the row's setups first).
 *
 * For each property of `row.expect`, on the first element the selector matches (or its pseudo):
 *  - `contract`: the property equals the zone's `--canopy-<name>`, and that variable equals the
 *    host value when the document is hosted and `hostValues` has the name, else the zone's
 *    `tokens.json` literal. Standalone with a `standalone.carbon` branch, the property is
 *    compared to the zone's `--cds-<token>` instead.
 *  - `carbon`: the property equals the zone's `--cds-<token>`.
 *  - `literal`, `mix`: the property equals the value, resolved inside the zone. Standalone, a
 *    `mix` with a `standalone.carbon` branch is compared to the zone's `--cds-<token>` instead.
 *  - `inside`: geometry, under `width` only: the element's left and right edges lie within the
 *    box of its nearest ancestor matching the selector, and its box is not empty. Hosted or
 *    standalone alike; the property's own value is not compared.
 *  - `fill` is compared as a colour, like every `*-color` property.
 *  - `hostOnly` targets are skipped standalone.
 *
 * Hosted is what the document says (`data-canopy-host` on `<html>`); `hosted` is what the caller
 * expects, and a document that disagrees fails the row. The postconditions of the row's setups
 * run last.
 *
 * @param {PageLike} page
 * @param {{ app: string, selector: string, pseudo?: string, setup: string[],
 *   expect: Record<string, object> }} row
 * @param {{ hosted?: boolean, hostValues?: Record<string, string>, tokens?: object,
 *   throwOnFailure?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, failures: string[], skipped: string[], gated: boolean | null,
 *   zone: string | null, checks: object[] }>}
 */
export async function checkRow(page, row, options = {}) {
  const { hosted = false, hostValues = {}, throwOnFailure = true } = options;
  const tokens = options.tokens ?? (await loadTokens());
  const what = `${row.app} ${row.selector}${row.pseudo ?? ''}`;
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const skipped = [];
  let out = { gated: /** @type {boolean | null} */ (null), zone: null, checks: [] };

  const matches = page.locator(row.selector);
  if ((await matches.count()) === 0) {
    failures.push('the selector matches no element');
  } else {
    out = await matches.first().evaluate(IN_PAGE, {
      expect: row.expect,
      pseudo: row.pseudo ?? null,
      hostValues,
      tokens,
      hostAttribute: HOST_ATTRIBUTE,
    });
    if (out.gated !== hosted) {
      failures.push(
        hosted
          ? `expected a hosted document, but <html> has no ${HOST_ATTRIBUTE}`
          : `expected a standalone document, but <html> has ${HOST_ATTRIBUTE}`
      );
    }
    if (out.zone === null) failures.push('the element is inside no Carbon zone');
    for (const check of /** @type {any[]} */ (out.checks)) {
      if (check.skipped) {
        skipped.push(check.property);
        continue;
      }
      for (const c of check.comparisons) {
        if (c.pass) continue;
        const subject = c.subject ?? check.property;
        const got = c.subject ? c.actual : check.actual;
        failures.push(
          `${subject} is ${show(got)}, expected ${show(c.expected)} (${c.against}` +
            (c.expectedRaw !== undefined ? `: ${c.expectedRaw || '(empty)'}` : '') +
            ')'
        );
      }
    }
  }

  for (const name of row.setup) {
    const post = /** @type {Record<string, ((page: PageLike) => Promise<void>) | undefined>} */ (
      setups.postconditions
    )[name];
    if (!post) continue;
    try {
      await post(page);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const result = {
    ok: failures.length === 0,
    failures,
    skipped,
    gated: out.gated,
    zone: out.zone,
    checks: out.checks,
  };
  if (!result.ok && throwOnFailure) {
    throw new ProbeFailure(`${what}\n  ${failures.join('\n  ')}`, result);
  }
  return result;
}
