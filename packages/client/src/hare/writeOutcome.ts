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
// This table mirrors each row's `outcome`, `status`, `code`, `default` and
// `dynamic`; a vitest (submit.test.ts) checks it against a byte copy of the
// vector file (packages/client/test-vectors/write_outcome_vectors.json). Edit
// both together, and change the vector file in canopy first. Every
// `WriteOutcome` names the row it came from (`row`).

import type { WriteOutcome, WriteOutcomeKind, WriteOutcomeRowId } from './types.js';

/**
 * One write-outcome row as the client needs it: `detail` is the row's default
 * (toast-ready) text; `dynamic` is true when the server fills in its own text.
 */
export interface WriteOutcomeRow {
  readonly outcome: WriteOutcomeKind | null;
  readonly status: number | null;
  readonly code: string | null;
  readonly detail: string | null;
  readonly dynamic: boolean;
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

/** Freeze every row and then the table, so no caller can edit the shared rows. */
function frozenRows(
  rows: Record<WriteOutcomeRowId, WriteOutcomeRow>
): Readonly<Record<WriteOutcomeRowId, WriteOutcomeRow>> {
  for (const row of Object.values(rows)) Object.freeze(row);
  return Object.freeze(rows);
}

/** Every write-outcome row by id, mirroring the vector file; frozen. */
export const WRITE_OUTCOME_ROWS: Readonly<Record<WriteOutcomeRowId, WriteOutcomeRow>> = frozenRows({
  'connector-refused': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: REFUSED_GENERIC,
    dynamic: true,
  },
  'connector-refused-read-only': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: 'the whole deployment is running read-only; nothing written',
    dynamic: false,
  },
  'connector-limits': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: REFUSED_GENERIC,
    dynamic: true,
  },
  'connector-target-changed': {
    outcome: 'target_changed',
    status: 409,
    code: 'pv_target_changed',
    detail: 'the control target changed; nothing written',
    dynamic: false,
  },
  'connector-switch-in-progress': {
    outcome: 'switch_in_progress',
    status: 409,
    code: 'pv_switch_in_progress',
    detail: 'a target switch is in progress; nothing written',
    dynamic: false,
  },
  confirmed: { outcome: 'confirmed', status: 200, code: null, detail: 'written', dynamic: false },
  mismatch: {
    outcome: 'mismatch',
    status: 409,
    code: 'pv_write_mismatch',
    detail: 'written; the channel holds a different value',
    dynamic: true,
  },
  unconfirmed: {
    outcome: 'unconfirmed',
    status: 502,
    code: 'pv_write_unconfirmed',
    detail: 'sent, not verified',
    dynamic: false,
  },
  'connector-unknown': {
    outcome: 'unknown',
    status: 502,
    code: 'pv_write_unknown',
    detail: UNKNOWN,
    dynamic: false,
  },
  'writes-not-enabled': {
    outcome: 'refused',
    status: 405,
    code: null,
    detail: 'writes are not enabled on this server',
    dynamic: false,
  },
  'front-refused-401': {
    outcome: 'refused',
    status: 401,
    code: 'invalid_access_credential',
    detail: FRONT_REFUSED,
    dynamic: false,
  },
  'front-refused-403': {
    outcome: 'refused',
    status: 403,
    code: 'pv_write_refused',
    detail: FRONT_REFUSED,
    dynamic: false,
  },
  'front-refused-404': {
    outcome: 'refused',
    status: 404,
    code: 'pv_write_refused',
    detail: FRONT_REFUSED,
    dynamic: false,
  },
  'front-refused-413': {
    outcome: 'refused',
    status: 413,
    code: 'pv_write_refused',
    detail: FRONT_REFUSED,
    dynamic: false,
  },
  'client-unknown': {
    outcome: 'unknown',
    status: null,
    code: null,
    detail: UNKNOWN,
    dynamic: false,
  },
  'target-changed': {
    outcome: 'target_changed',
    status: null,
    code: null,
    detail: TARGET_OR_WRITES_CHANGED,
    dynamic: false,
  },
  'write-state-changed': {
    outcome: 'target_changed',
    status: null,
    code: null,
    detail: WRITES_CHANGED,
    dynamic: true,
  },
  coalesced: { outcome: null, status: null, code: null, detail: null, dynamic: false },
});

/**
 * The viewer's toast for a run stopped by a coalesced write (row
 * `coalesced`). A coalesced outcome itself is never toasted.
 */
export const WRITE_OUTCOME_COALESCED_TOAST = 'a newer value replaced this one; nothing more sent';

/** A row an outcome can name: every row but `coalesced`, which has no outcome of its own. */
type OutcomeRowId = WriteOutcome['row'];

/**
 * The detail of the `client-unknown` outcome `HarePVService.submit()` gives a
 * value that waited its whole time budget behind an earlier write to the same
 * PV: this value was never sent, and that earlier write has had no reply, so
 * what the PV holds is not known.
 */
export const WRITE_OUTCOME_NOT_SENT_DETAIL =
  'not sent: an earlier write to this PV is still unanswered — check the readback';

/**
 * How each recognised envelope code maps: the row whose outcome it takes and
 * whose default detail stands in for a missing one, and whether the server's
 * own detail is the toast. Server rows (`pv_*`) carry toast text as their
 * detail; FRONT's access gate (`invalid_access_credential`) does not, so its
 * row text is used. Any other code is row `client-unknown`.
 */
const CODE_ROWS: Readonly<Record<string, { row: OutcomeRowId; serverDetail: boolean }>> = {
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
export const WRITE_OUTCOME_CODE_ROWS: Readonly<Record<string, WriteOutcomeRowId>> = Object.freeze(
  Object.fromEntries(Object.entries(CODE_ROWS).map(([code, { row }]) => [code, row]))
);

/**
 * Server rows with fixed text (`dynamic: false`), in table order. Such a row
 * shares its status and code with others (`front-refused-403` and
 * `connector-refused-read-only` with `connector-refused`); the server sends its
 * text verbatim, so that text tells the row.
 */
const FIXED_SERVER_ROWS = (Object.keys(WRITE_OUTCOME_ROWS) as OutcomeRowId[]).filter((id) => {
  const row = WRITE_OUTCOME_ROWS[id];
  return !row.dynamic && row.status !== null && row.code !== null;
});

/** The fixed server row with this status, code and detail, if there is one. */
function fixedServerRow(status: number, code: string, detail: string): OutcomeRowId | undefined {
  return FIXED_SERVER_ROWS.find((id) => {
    const row = WRITE_OUTCOME_ROWS[id];
    return row.status === status && row.code === code && row.detail === detail;
  });
}

function rowOutcome(
  rowId: OutcomeRowId,
  status: number | null,
  code: string | null,
  detail?: string
): WriteOutcome {
  const row = WRITE_OUTCOME_ROWS[rowId];
  return {
    outcome: row.outcome!,
    row: rowId,
    code,
    status,
    detail: detail ?? row.detail!,
    coalesced: false,
  };
}

/** Row `write-state-changed`'s text with its one token, `<label>`; a null label takes the row's default. */
const WRITES_CHANGED_TEMPLATE = 'the write state of <label> changed; nothing written';

/** A row the client answers itself, with no request sent or no reply. */
export type ClientRowId = Extract<
  WriteOutcomeRowId,
  'client-unknown' | 'target-changed' | 'write-state-changed'
>;

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

/**
 * The outcome a PV service answers itself, with no server and no reply
 * (`LocalPVService`, `MockPVService`, `RoutedPVService`): the row's default
 * text, no status or code. Not part of the package's public API.
 */
export function serviceOutcome(
  rowId: Extract<WriteOutcomeRowId, 'confirmed' | 'connector-refused' | 'writes-not-enabled'>
): WriteOutcome {
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
 * unrecognised code, or a non-2xx with no envelope, is `client-unknown`. Among
 * the rows a code maps to, a fixed-text row is the one whose status and text
 * the reply carries (`front-refused-403`, `connector-refused-read-only`);
 * otherwise the code's own row.
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
  if (!mapping.serverDetail) return rowOutcome(mapping.row, status, code);
  const detail = toastText(envelope?.detail);
  const fixed = detail === undefined ? undefined : fixedServerRow(status, code!, detail);
  return rowOutcome(fixed ?? mapping.row, status, code, detail);
}
