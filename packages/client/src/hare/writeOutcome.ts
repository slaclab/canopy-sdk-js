// The write-outcome table: how a PUT /hare/v1/pvs/{pv} (or its absence)
// becomes a `WriteOutcome`.
//
// canopy owns the write-outcome contract. Its one definition is the vector
// file `src/canopy/contracts/write_outcome_vectors.json` in the canopy
// repository: one entry per row, each row one way a screen write can end
// (refused by the PV connector, refused by the panel server in front of canopy,
// the readback did not match, no reply, the control target changed, ...), with
// its HTTP status, envelope `code` and the toast text the viewer shows. A row
// id names who decides the outcome and how: `connector-refused`,
// `front-refused-401`, `client-unknown`. The vector file's `about` field
// describes the fields of a row; the canopy server and this client both map
// their outcomes from it.
//
// This table mirrors each row's `outcome`, `status`, `code` and `default`; a
// vitest (submit.test.ts) checks it against a byte copy of the vector file
// (packages/client/test-vectors/write_outcome_vectors.json). Edit both
// together, and change the vector file in canopy first.

import type { WriteOutcome, WriteOutcomeKind } from './types.js';

/** One write-outcome row as the client needs it: `detail` is the row's default (toast-ready) text. */
export interface WriteOutcomeRow {
  outcome: WriteOutcomeKind | null;
  status: number | null;
  code: string | null;
  detail: string | null;
}

/**
 * Longest envelope detail a server row carries, in Unicode code points with the
 * cut's ellipsis included; longer text is cut here too, on a word boundary.
 */
export const WRITE_OUTCOME_DETAIL_MAX_CHARS = 512;

const DETAIL_ELLIPSIS = '\u2026';

/**
 * `text` when it fits in `limit` code points; otherwise the longest whole-word
 * prefix (trailing whitespace dropped) followed by an ellipsis, at most `limit`
 * code points long. A first word longer than the limit is cut inside the word.
 */
export function cutWriteOutcomeDetail(
  text: string,
  limit: number = WRITE_OUTCOME_DETAIL_MAX_CHARS
): string {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  const headChars = chars.slice(0, limit - 1);
  let head = headChars.join('');
  if (!/\s/.test(chars[headChars.length]!)) {
    // Python's head.rsplit(None, 1)[0]: all before the last whitespace run that
    // separates two words, trailing whitespace ignored.
    const words = /^([\s\S]*\S)\s+\S+\s*$/.exec(head);
    if (words) head = words[1]!;
  }
  return head.trimEnd() + DETAIL_ELLIPSIS;
}

const REFUSED_GENERIC = 'the write was refused; nothing written';
const TARGET_OR_WRITES_CHANGED = 'the control target or its write state changed; nothing written';
const WRITES_CHANGED = 'the write state of this target changed; nothing written';
const UNKNOWN = 'outcome unknown — check the readback';
const FRONT_REFUSED = 'the panel server refused this write; nothing written';

/** Every write-outcome row by id, mirroring the vector file. */
export const WRITE_OUTCOME_ROWS: Readonly<Record<string, WriteOutcomeRow>> = {
  'connector-refused': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: REFUSED_GENERIC,
  },
  'connector-refused-read-only': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'the whole deployment is running read-only; nothing written',
  },
  'connector-limits': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: REFUSED_GENERIC,
  },
  'connector-target-changed': {
    outcome: 'target_changed',
    status: 409,
    code: 'pv_target_changed',
    detail: 'the control target changed; nothing written',
  },
  'connector-switch-in-progress': {
    outcome: 'switch_in_progress',
    status: 409,
    code: 'pv_switch_in_progress',
    detail: 'a target switch is in progress; nothing written',
  },
  confirmed: { outcome: 'confirmed', status: 200, code: null, detail: 'written' },
  mismatch: {
    outcome: 'mismatch',
    status: 409,
    code: 'pv_write_mismatch',
    detail: 'written; the channel holds a different value',
  },
  unconfirmed: {
    outcome: 'unconfirmed',
    status: 502,
    code: 'pv_write_unconfirmed',
    detail: 'sent, not verified',
  },
  'connector-unknown': {
    outcome: 'unknown',
    status: 502,
    code: 'pv_write_unknown',
    detail: UNKNOWN,
  },
  'writes-not-enabled': {
    outcome: 'refused',
    status: 405,
    code: null,
    detail: 'writes are not enabled on this server',
  },
  'front-refused-401': {
    outcome: 'refused',
    status: 401,
    code: 'invalid_access_credential',
    detail: FRONT_REFUSED,
  },
  'front-refused-403': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: FRONT_REFUSED,
  },
  'front-refused-404': {
    outcome: 'refused',
    status: 404,
    code: 'pv_write_refused',
    detail: FRONT_REFUSED,
  },
  'front-refused-413': {
    outcome: 'refused',
    status: 413,
    code: 'pv_write_refused',
    detail: FRONT_REFUSED,
  },
  'client-unknown': { outcome: 'unknown', status: null, code: null, detail: UNKNOWN },
  'target-changed': {
    outcome: 'target_changed',
    status: null,
    code: null,
    detail: TARGET_OR_WRITES_CHANGED,
  },
  'write-state-changed': {
    outcome: 'target_changed',
    status: null,
    code: null,
    detail: WRITES_CHANGED,
  },
  coalesced: { outcome: null, status: null, code: null, detail: null },
};

/**
 * The viewer's toast for a run stopped by a coalesced write (row
 * `coalesced`). A coalesced outcome itself is never toasted.
 */
export const WRITE_OUTCOME_COALESCED_TOAST = 'a newer value replaced this one; nothing more sent';

/**
 * How each recognised envelope code maps: the row whose outcome it takes and
 * whose default detail stands in for a missing one, and whether the server's
 * own detail is the toast. Server rows (`pv_*`) carry toast text as their
 * detail; FRONT's access gate (`invalid_access_credential`) does not, so its
 * row text is used. Any other code is row `client-unknown`.
 */
const CODE_ROWS: Readonly<Record<string, { row: string; serverDetail: boolean }>> = {
  pv_write_refused: { row: 'connector-refused', serverDetail: true },
  pv_target_changed: { row: 'connector-target-changed', serverDetail: true },
  pv_switch_in_progress: { row: 'connector-switch-in-progress', serverDetail: true },
  pv_write_mismatch: { row: 'mismatch', serverDetail: true },
  pv_write_unconfirmed: { row: 'unconfirmed', serverDetail: true },
  pv_write_unknown: { row: 'connector-unknown', serverDetail: true },
  invalid_access_credential: { row: 'front-refused-401', serverDetail: false },
};

/**
 * The envelope code → row id map. Not part of the package's public API: it is
 * exported from this module only so the outcome-table test can check it
 * against the vector file.
 */
export const WRITE_OUTCOME_CODE_ROWS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CODE_ROWS).map(([code, { row }]) => [code, row])
);

function rowOutcome(
  rowId: string,
  status: number | null,
  code: string | null,
  detail?: string
): WriteOutcome {
  const row = WRITE_OUTCOME_ROWS[rowId]!;
  return {
    outcome: row.outcome!,
    code,
    status,
    detail: detail ?? row.detail!,
    coalesced: false,
  };
}

/** Row `write-state-changed`'s text with its one token, `<label>`; a null label takes the row's default. */
const WRITES_CHANGED_TEMPLATE = 'the write state of <label> changed; nothing written';

/** A row the client answers itself, with no request sent or no reply. */
export type ClientRowId = 'client-unknown' | 'target-changed' | 'write-state-changed';

/**
 * A client-side row that sent no request or got no reply: `client-unknown`,
 * `target-changed` (the target or its write state changed) or
 * `write-state-changed` (the write state of the target named by `label`
 * changed). Only `write-state-changed` reads `label`; a null or absent label
 * gives the row's default text.
 */
export function clientOutcome(rowId: ClientRowId, label?: string | null): WriteOutcome {
  if (rowId === 'write-state-changed' && label != null) {
    return rowOutcome(
      rowId,
      null,
      null,
      WRITES_CHANGED_TEMPLATE.replace('<label>', () => label)
    );
  }
  return rowOutcome(rowId, null, null);
}

/** Trimmed server detail cut to the cap, or undefined when it is not usable text. */
function toastText(detail: unknown): string | undefined {
  if (typeof detail !== 'string') return undefined;
  const text = detail.trim();
  if (text === '') return undefined;
  return cutWriteOutcomeDetail(text);
}

/** The parsed body when it is a JSON object (not an array, not null), else null. */
function jsonObject(bodyText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/**
 * Map a PUT response to its write outcome. A redirect (`type` is
 * `'opaqueredirect'` under `redirect: 'manual'`, or any 3xx status) is
 * `client-unknown`: the write did not reach the relay, or nobody can say
 * whether it did. A 2xx is `confirmed` only when its body is the server's
 * write result, a JSON object with a string `pv` (shape only: the name is not
 * compared); any other 2xx body — a followed redirect's login page, an empty
 * body — is `client-unknown`. Other statuses map by envelope code, and a 405
 * with none is `writes-not-enabled` (generic canopy with the relay off). An
 * unrecognised code, or a non-2xx with no envelope, is `client-unknown`.
 */
export function outcomeFromResponse(
  ok: boolean,
  status: number,
  bodyText: string,
  type?: string
): WriteOutcome {
  if (type === 'opaqueredirect') return rowOutcome('client-unknown', null, null);
  if (status >= 300 && status < 400) return rowOutcome('client-unknown', status, null);
  if (ok) {
    const result = jsonObject(bodyText);
    return typeof result?.pv === 'string'
      ? rowOutcome('confirmed', status, null)
      : rowOutcome('client-unknown', status, null);
  }
  if (status === 405) return rowOutcome('writes-not-enabled', status, null);

  const envelope = jsonObject(bodyText);
  const code = typeof envelope?.code === 'string' ? envelope.code : null;
  const mapping = code !== null && Object.hasOwn(CODE_ROWS, code) ? CODE_ROWS[code] : undefined;
  if (!mapping) return rowOutcome('client-unknown', status, code);
  const detail = mapping.serverDetail ? toastText(envelope?.detail) : undefined;
  return rowOutcome(mapping.row, status, code, detail);
}
