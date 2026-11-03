// HarePVService.submit() and heartbeat(): the write-outcome client discipline
// (target-changed without a request, the heartbeat binding, one request in flight per PV,
// coalescing, no retry, the put time budget) and the outcome table, which is
// checked against ../../test-vectors/write_outcome_vectors.json — a byte copy
// of canopy's src/canopy/contracts/write_outcome_vectors.json. Never edit or reformat that
// copy here; copy it again from canopy.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebSocketFactory } from '../testing/fakeWebSocket.js';
import { HarePVService } from './HarePVService.js';
import type { FetchLike } from './HarePVService.js';
import type { HareHeartbeatFrame, HareHeartbeatState, WriteOutcome } from './types.js';
import {
  WRITE_OUTCOME_COALESCED_TOAST,
  WRITE_OUTCOME_CODE_ROWS,
  WRITE_OUTCOME_DETAIL_MAX_CHARS,
  WRITE_OUTCOME_ROWS,
  clientOutcome,
  cutWriteOutcomeDetail,
  outcomeFromResponse,
} from './writeOutcome.js';

import vectorFile from '../../test-vectors/write_outcome_vectors.json' with { type: 'json' };

type VectorRow = {
  outcome: string | null;
  status: number | null;
  code: string | null;
  detail: string | null;
  default: string | null;
  toast: string | null;
  dynamic: boolean;
};
const vectors = vectorFile as unknown as {
  detail_max_chars: number;
  detail_cut_cases: Array<{ case: string; text: string; limit: number; expected: string }>;
  rows: Record<string, VectorRow>;
};

const BASE_URL = 'ws://host/hare/v1/ws/pvs';
const BINDING = 'va@3';
const UNKNOWN_TEXT = 'outcome unknown — check the readback';
const TARGET_CHANGED_TEXT = vectors.rows['target-changed']!.default!;

function heartbeatFrame(binding: string | null, backend = 'va'): HareHeartbeatFrame {
  return { type: 'heartbeat', timestamp: 0, backend, label: null, notice: null, binding };
}

type Reply = { ok: boolean; status: number; text?: string; type?: string };

/** The server's write result (`PVWriteResultDTO`): what a real 2xx carries. */
const WRITE_RESULT = '{"pv":"X"}';

/** A reply's body: its own text, else the write result for a 2xx and nothing otherwise. */
function replyText(reply: Reply): string {
  return reply.text ?? (reply.ok ? WRITE_RESULT : '');
}

/** A fetch whose replies the test releases one by one. */
function deferredFetch() {
  const calls: Array<{
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }> = [];
  const releases: Array<(reply: Reply | Error) => void> = [];
  const fetchFn = vi.fn<FetchLike>(
    (url, init) =>
      new Promise((resolve, reject) => {
        calls.push({ url, body: JSON.parse(init.body as string), headers: init.headers });
        releases.push((reply) => {
          if (reply instanceof Error) {
            reject(reply);
          } else {
            resolve({
              ok: reply.ok,
              status: reply.status,
              type: reply.type,
              text: async () => replyText(reply),
            });
          }
        });
      })
  );
  return { fetchFn, calls, releases };
}

function replyFetch(reply: Reply) {
  return vi.fn<FetchLike>(async () => ({
    ok: reply.ok,
    status: reply.status,
    type: reply.type,
    text: async () => replyText(reply),
  }));
}

function connected(
  fetchFn: FetchLike,
  extra: { binding?: string | null; onHeartbeat?: (s: HareHeartbeatState) => void } = {}
) {
  const { factory, instances } = createFakeWebSocketFactory();
  const service = new HarePVService({
    url: BASE_URL,
    apiKey: 'k',
    webSocketFactory: factory,
    fetchFn,
    onHeartbeat: extra.onHeartbeat,
    // No pong in these tests: keep the liveness check from closing the socket.
    pingIntervalMs: 1e9,
  });
  service.connect();
  const socket = instances[0]!;
  socket.open();
  socket.message(heartbeatFrame(extra.binding === undefined ? BINDING : extra.binding));
  return { service, socket, instances };
}

/** Track a promise's settlement without awaiting it. */
function track(p: Promise<WriteOutcome>) {
  const box: { value?: WriteOutcome } = {};
  void p.then((v) => {
    box.value = v;
  });
  return box;
}

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function envelope(code: string, detail: string): string {
  return JSON.stringify({ code, detail });
}

describe('write-outcome table', () => {
  it('equals the vector file row for row (outcome, status, code, default detail)', () => {
    expect(Object.keys(WRITE_OUTCOME_ROWS).sort()).toEqual(Object.keys(vectors.rows).sort());
    for (const [id, row] of Object.entries(vectors.rows)) {
      expect(WRITE_OUTCOME_ROWS[id], id).toEqual({
        outcome: row.outcome,
        status: row.status,
        code: row.code,
        detail: row.default,
      });
    }
    expect(WRITE_OUTCOME_COALESCED_TOAST).toBe(vectors.rows['coalesced']!.toast);
  });

  it('caps an envelope detail at the vector file length', () => {
    expect(WRITE_OUTCOME_DETAIL_MAX_CHARS).toBe(vectors.detail_max_chars);
  });

  it('carries cut cases in the vector file', () => {
    expect(vectors.detail_cut_cases.length).toBeGreaterThan(0);
  });

  for (const c of vectors.detail_cut_cases) {
    it(`cuts a detail like canopy: ${c.case}`, () => {
      expect(cutWriteOutcomeDetail(c.text, c.limit)).toBe(c.expected);
      expect(cutWriteOutcomeDetail(c.expected, c.limit)).toBe(c.expected);
      expect(Array.from(cutWriteOutcomeDetail(c.text, c.limit)).length).toBeLessThanOrEqual(
        c.limit
      );
    });
  }

  it('cuts at the cap by default, on a word boundary', () => {
    const sentence = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const got = cutWriteOutcomeDetail(sentence);
    expect(Array.from(got).length).toBeLessThanOrEqual(WRITE_OUTCOME_DETAIL_MAX_CHARS);
    expect(got.endsWith('\u2026')).toBe(true);
    expect(sentence.startsWith(got.slice(0, -1) + ' ')).toBe(true);
  });

  it('answers target-changed with its own text', () => {
    expect(clientOutcome('target-changed')).toEqual({
      outcome: 'target_changed',
      code: null,
      status: null,
      detail: vectors.rows['target-changed']!.default,
      coalesced: false,
    });
  });

  it('fills write-state-changed with the label, and with the default for a null label', () => {
    const row = vectors.rows['write-state-changed']!;
    expect(row.dynamic).toBe(true);
    expect(clientOutcome('write-state-changed', 'Simulator')).toEqual({
      outcome: 'target_changed',
      code: null,
      status: null,
      detail: row.detail!.replace('<label>', 'Simulator'),
      coalesced: false,
    });
    expect(clientOutcome('write-state-changed', 'Simulator').detail).toBe(
      'the write state of Simulator changed; nothing written'
    );
    expect(clientOutcome('write-state-changed', null).detail).toBe(row.default);
    expect(clientOutcome('write-state-changed').detail).toBe(row.default);
  });

  it('fills only the label token: a label that looks like a token stays as given', () => {
    expect(clientOutcome('write-state-changed', '<label>').detail).toBe(
      'the write state of <label> changed; nothing written'
    );
    expect(clientOutcome('write-state-changed', '$&').detail).toBe(
      'the write state of $& changed; nothing written'
    );
  });

  it('maps every recognised code to a row carrying that code', () => {
    const serverCodes = new Set(
      Object.values(vectors.rows)
        .map((r) => r.code)
        .filter((c): c is string => c !== null)
    );
    expect(new Set(Object.keys(WRITE_OUTCOME_CODE_ROWS))).toEqual(serverCodes);
    for (const [code, rowId] of Object.entries(WRITE_OUTCOME_CODE_ROWS)) {
      expect(vectors.rows[rowId]!.code).toBe(code);
    }
  });

  it('takes each fixed server row back to its outcome and detail from its own envelope', () => {
    for (const [id, row] of Object.entries(vectors.rows)) {
      if (row.status === null || row.outcome === null) continue;
      const ok = row.status >= 200 && row.status < 300;
      const text = ok ? WRITE_RESULT : row.code === null ? '' : envelope(row.code, row.default!);
      const got = outcomeFromResponse(ok, row.status, text);
      expect(got, id).toEqual({
        outcome: row.outcome,
        code: row.code,
        status: row.status,
        detail: row.default,
        coalesced: false,
      });
    }
  });

  it('uses the server detail verbatim for server rows, the default when it is empty', () => {
    expect(
      outcomeFromResponse(false, 403, envelope('pv_write_refused', 'channel SR:X is read-only'))
    ).toMatchObject({ outcome: 'refused', detail: 'channel SR:X is read-only' });
    expect(outcomeFromResponse(false, 403, envelope('pv_write_refused', '  '))).toMatchObject({
      outcome: 'refused',
      detail: 'the write was refused; nothing written',
    });
    expect(
      outcomeFromResponse(false, 409, JSON.stringify({ code: 'pv_write_mismatch' }))
    ).toMatchObject({
      outcome: 'mismatch',
      detail: 'written; the channel holds a different value',
    });
    expect(
      outcomeFromResponse(false, 409, envelope('pv_write_mismatch', 'written; the channel holds 4'))
    ).toMatchObject({ outcome: 'mismatch', detail: 'written; the channel holds 4' });
  });

  it('keeps a server detail that fits the cap whole', () => {
    const text = `refused: ${'limit '.repeat(60).trim()}`;
    expect(text.length).toBeGreaterThan(256);
    expect(text.length).toBeLessThanOrEqual(WRITE_OUTCOME_DETAIL_MAX_CHARS);
    const got = outcomeFromResponse(false, 403, envelope('pv_write_refused', text));
    expect(got.detail).toBe(text);
  });

  it('cuts an over-long server detail at the cap on a word boundary, after trimming', () => {
    const text = Array(200).fill('abcdefg').join(' ');
    const got = outcomeFromResponse(false, 403, envelope('pv_write_refused', `  ${text}\n`));
    expect(got.detail!.endsWith('abcdefg\u2026')).toBe(true);
    expect(Array.from(got.detail!).length).toBeLessThanOrEqual(WRITE_OUTCOME_DETAIL_MAX_CHARS);
    expect(text.startsWith(got.detail!.slice(0, -1) + ' ')).toBe(true);
  });

  it('cuts a single over-long server token inside the token', () => {
    const got = outcomeFromResponse(false, 403, envelope('pv_write_refused', 'x'.repeat(600)));
    expect(got.detail).toBe('x'.repeat(WRITE_OUTCOME_DETAIL_MAX_CHARS - 1) + '\u2026');
  });

  it('never toasts a raw body: 405, FRONT 401, unrecognised codes and non-envelopes take the table text', () => {
    expect(outcomeFromResponse(false, 405, '{"detail":"Method Not Allowed"}')).toEqual({
      outcome: 'refused',
      code: null,
      status: 405,
      detail: 'writes are not enabled on this server',
      coalesced: false,
    });
    expect(
      outcomeFromResponse(false, 401, envelope('invalid_access_credential', 'bad X-Canopy-Access'))
    ).toMatchObject({
      outcome: 'refused',
      code: 'invalid_access_credential',
      detail: 'the panel server refused this write; nothing written',
    });
    expect(outcomeFromResponse(false, 500, envelope('pv_write_failed', 'Traceback ...'))).toEqual({
      outcome: 'unknown',
      code: 'pv_write_failed',
      status: 500,
      detail: UNKNOWN_TEXT,
      coalesced: false,
    });
    expect(outcomeFromResponse(false, 500, '<html>Internal Server Error</html>')).toMatchObject({
      outcome: 'unknown',
      code: null,
      detail: UNKNOWN_TEXT,
    });
    expect(outcomeFromResponse(false, 422, '[1,2]')).toMatchObject({
      outcome: 'unknown',
      detail: UNKNOWN_TEXT,
    });
  });

  it('reads a 2xx as written only when its body is a JSON object with a string pv', () => {
    const unknown = (status: number) => ({
      outcome: 'unknown',
      code: null,
      status,
      detail: UNKNOWN_TEXT,
      coalesced: false,
    });
    expect(outcomeFromResponse(true, 200, '{"pv":"SR:X","value":1}')).toEqual({
      outcome: 'confirmed',
      code: null,
      status: 200,
      detail: 'written',
      coalesced: false,
    });
    // Shape only: the name is not compared with the written PV.
    expect(outcomeFromResponse(true, 200, '{"pv":"other"}').outcome).toBe('confirmed');
    expect(outcomeFromResponse(true, 200, '<html><form>Sign in</form></html>')).toEqual(
      unknown(200)
    );
    expect(outcomeFromResponse(true, 200, '')).toEqual(unknown(200));
    expect(outcomeFromResponse(true, 204, '')).toEqual(unknown(204));
    expect(outcomeFromResponse(true, 200, '{"pv":7}')).toEqual(unknown(200));
    expect(outcomeFromResponse(true, 200, '{"value":1}')).toEqual(unknown(200));
    expect(outcomeFromResponse(true, 200, '[{"pv":"X"}]')).toEqual(unknown(200));
    expect(outcomeFromResponse(true, 200, 'null')).toEqual(unknown(200));
  });

  it('reads any redirect as unknown, whatever its body', () => {
    expect(outcomeFromResponse(false, 0, '', 'opaqueredirect')).toEqual({
      outcome: 'unknown',
      code: null,
      status: null,
      detail: UNKNOWN_TEXT,
      coalesced: false,
    });
    // An opaque redirect is unknown even from a fetch that reports it as ok.
    expect(outcomeFromResponse(true, 200, WRITE_RESULT, 'opaqueredirect').outcome).toBe('unknown');
    for (const status of [301, 302, 303, 307, 308]) {
      expect(outcomeFromResponse(false, status, WRITE_RESULT), String(status)).toEqual({
        outcome: 'unknown',
        code: null,
        status,
        detail: UNKNOWN_TEXT,
        coalesced: false,
      });
    }
    expect(
      outcomeFromResponse(false, 302, envelope('pv_write_refused', 'nothing written')).outcome
    ).toBe('unknown');
  });
});

describe('HarePVService.heartbeat / submit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── heartbeat() ──────────────────────────────────────────────────────────

  describe('heartbeat()', () => {
    it('is unseen before the socket opens and before its first heartbeat', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      expect(service.heartbeat()).toEqual({ seen: false, binding: null });
      service.connect();
      instances[0]!.open();
      expect(service.heartbeat()).toEqual({ seen: false, binding: null });
      instances[0]!.message(heartbeatFrame(BINDING));
      expect(service.heartbeat()).toEqual({ seen: true, binding: BINDING });
    });

    it('is per socket: a reconnect is unseen until the new socket heartbeats, and onHeartbeat says so', async () => {
      const states: HareHeartbeatState[] = [];
      const backendChanges = vi.fn();
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        reconnectDelaysMs: [10],
        onHeartbeat: (s) => states.push(s),
        onBackendChange: backendChanges,
      });
      service.connect();
      instances[0]!.open();
      instances[0]!.message(heartbeatFrame(BINDING));
      instances[0]!.message(heartbeatFrame(BINDING)); // unchanged: no event
      instances[0]!.close();
      expect(service.heartbeat()).toEqual({ seen: false, binding: null });

      await vi.advanceTimersByTimeAsync(10);
      instances[1]!.open();
      expect(service.heartbeat().seen).toBe(false);
      instances[1]!.message(heartbeatFrame(BINDING));
      expect(service.heartbeat()).toEqual({ seen: true, binding: BINDING });

      expect(states).toEqual([
        { seen: true, binding: BINDING },
        { seen: false, binding: null },
        { seen: true, binding: BINDING },
      ]);
      // Every socket's first heartbeat is a backend change, even with the same identity.
      expect(backendChanges).toHaveBeenCalledTimes(2);
    });

    it('follows a binding change, also through onBackendChange', () => {
      const states: HareHeartbeatState[] = [];
      const backendChanges = vi.fn();
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        onHeartbeat: (s) => states.push(s),
        onBackendChange: backendChanges,
      });
      service.connect();
      instances[0]!.open();
      instances[0]!.message(heartbeatFrame(BINDING));
      instances[0]!.message(heartbeatFrame('va@4'));
      expect(service.heartbeat()).toEqual({ seen: true, binding: 'va@4' });
      expect(states.at(-1)).toEqual({ seen: true, binding: 'va@4' });
      expect(backendChanges).toHaveBeenCalledTimes(2);
    });

    it('is unseen after disconnect()', () => {
      const { service } = connected(replyFetch({ ok: true, status: 200 }));
      service.disconnect();
      expect(service.heartbeat()).toEqual({ seen: false, binding: null });
    });
  });

  // ── target-changed with no request ──────────────────────────────────────────

  describe('target-changed without a request', () => {
    it('answers target_changed when never connected', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200 });
      const service = new HarePVService({ url: BASE_URL, fetchFn });
      await expect(service.submit('X', 1)).resolves.toEqual({
        outcome: 'target_changed',
        code: null,
        status: null,
        detail: TARGET_CHANGED_TEXT,
        coalesced: false,
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('answers target_changed when the socket is open but has sent no heartbeat', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200 });
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory, fetchFn });
      service.connect();
      instances[0]!.open();
      const got = await service.submit('X', 1, { binding: BINDING });
      expect(got.outcome).toBe('target_changed');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('answers target_changed after the socket closed', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200 });
      const { service, socket } = connected(fetchFn);
      socket.close();
      expect((await service.submit('X', 1)).outcome).toBe('target_changed');
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  // ── the request ──────────────────────────────────────────────────────────

  describe('request', () => {
    it('sends the current heartbeat binding at call time when no binding is given (confirm off)', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200, text: '{"pv":"X"}' });
      const { service, socket } = connected(fetchFn);
      socket.message(heartbeatFrame('va@7'));

      const got = await service.submit('SR:X', 2.5, {
        origin: { screen: 'sr/overview', rev: 'r1' },
      });

      expect(got).toEqual({
        outcome: 'confirmed',
        code: null,
        status: 200,
        detail: 'written',
        coalesced: false,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(url).toBe('http://host/hare/v1/pvs/SR%3AX');
      expect(init.method).toBe('PUT');
      expect(init.headers['X-API-Key']).toBe('k');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({
        value: 2.5,
        binding: 'va@7',
        origin: { screen: 'sr/overview', rev: 'r1' },
      });
    });

    it('sends an explicit binding (captured at dialog open) instead of the current one', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200 });
      const { service } = connected(fetchFn);
      await service.submit('X', 1, { binding: 'va@2', timeoutS: 3 });
      expect(JSON.parse(fetchFn.mock.calls[0]![1].body as string)).toEqual({
        value: 1,
        binding: 'va@2',
        timeout: 3,
      });
    });

    it('omits binding from the body when it is null', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200 });
      const { service } = connected(fetchFn, { binding: null });
      await service.submit('X', 1);
      await service.submit('Y', 1, { binding: null });
      expect(JSON.parse(fetchFn.mock.calls[0]![1].body as string)).toEqual({ value: 1 });
      expect(JSON.parse(fetchFn.mock.calls[1]![1].body as string)).toEqual({ value: 1 });
    });

    it('sends confirmed: true when a person confirmed the write, and no confirmed key otherwise', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200 });
      const { service } = connected(fetchFn, { binding: null });
      await service.submit('X', 1, { confirmed: true });
      await service.submit('Y', 1, { confirmed: false });
      await service.submit('Z', 1);
      expect(JSON.parse(fetchFn.mock.calls[0]![1].body as string)).toEqual({
        value: 1,
        confirmed: true,
      });
      expect(JSON.parse(fetchFn.mock.calls[1]![1].body as string)).toEqual({ value: 1 });
      expect(JSON.parse(fetchFn.mock.calls[2]![1].body as string)).toEqual({ value: 1 });
    });

    it('maps the response by code with toast-ready detail', async () => {
      const fetchFn = replyFetch({
        ok: false,
        status: 403,
        text: envelope('pv_write_refused', 'channel SR:X is read-only'),
      });
      const { service } = connected(fetchFn);
      await expect(service.submit('X', 1)).resolves.toEqual({
        outcome: 'refused',
        code: 'pv_write_refused',
        status: 403,
        detail: 'channel SR:X is read-only',
        coalesced: false,
      });
    });

    it('never rejects: a network error is client-unknown, and is not retried', async () => {
      const fetchFn = vi.fn<FetchLike>(async () => {
        throw new Error('network down');
      });
      const { service } = connected(fetchFn);
      await expect(service.submit('X', 1)).resolves.toEqual({
        outcome: 'unknown',
        code: null,
        status: null,
        detail: UNKNOWN_TEXT,
        coalesced: false,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('never rejects when fetch throws synchronously or the body cannot be read', async () => {
      const throwing = vi.fn<FetchLike>(() => {
        throw new TypeError('bad init');
      });
      const a = connected(throwing);
      expect((await a.service.submit('X', 1)).outcome).toBe('unknown');

      const unreadable = vi.fn<FetchLike>(async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error('stream reset');
        },
      }));
      // A 2xx is confirmed only on a write-result body; an unreadable one is client-unknown.
      const b = connected(unreadable);
      expect((await b.service.submit('X', 1)).outcome).toBe('unknown');
    });

    it('asks fetch not to follow redirects', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200 });
      const { service } = connected(fetchFn);
      await service.submit('X', 1);
      expect(fetchFn.mock.calls[0]![1].redirect).toBe('manual');
    });

    it('a followed redirect to a login page (2xx HTML) is unknown, not written', async () => {
      // A fetch that ignores redirect: 'manual' and lands on the login page.
      const fetchFn = vi.fn<FetchLike>(async () => ({
        ok: true,
        status: 200,
        type: 'basic',
        text: async () => '<!doctype html><title>Sign in</title><form action="/login"></form>',
      }));
      const { service } = connected(fetchFn);
      await expect(service.submit('X', 1)).resolves.toEqual({
        outcome: 'unknown',
        code: null,
        status: 200,
        detail: UNKNOWN_TEXT,
        coalesced: false,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('an opaque redirect is unknown', async () => {
      const fetchFn = replyFetch({ ok: false, status: 0, type: 'opaqueredirect', text: '' });
      const { service } = connected(fetchFn);
      await expect(service.submit('X', 1)).resolves.toEqual({
        outcome: 'unknown',
        code: null,
        status: null,
        detail: UNKNOWN_TEXT,
        coalesced: false,
      });
    });

    it('a 302 is unknown', async () => {
      const fetchFn = replyFetch({ ok: false, status: 302, text: '' });
      const { service } = connected(fetchFn);
      await expect(service.submit('X', 1)).resolves.toEqual({
        outcome: 'unknown',
        code: null,
        status: 302,
        detail: UNKNOWN_TEXT,
        coalesced: false,
      });
    });

    it('a 2xx with an HTML body is unknown', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200, text: '<html>ok</html>' });
      const { service } = connected(fetchFn);
      const got = await service.submit('X', 1);
      expect(got).toMatchObject({ outcome: 'unknown', status: 200, detail: UNKNOWN_TEXT });
    });

    it('a 2xx with an empty body is unknown', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200, text: '' });
      const { service } = connected(fetchFn);
      const got = await service.submit('X', 1);
      expect(got).toMatchObject({ outcome: 'unknown', status: 200, detail: UNKNOWN_TEXT });
    });

    it('a 2xx with the write result {pv} is written', async () => {
      const fetchFn = replyFetch({ ok: true, status: 200, text: '{"pv":"SR:X","value":1}' });
      const { service } = connected(fetchFn);
      await expect(service.submit('SR:X', 1)).resolves.toEqual({
        outcome: 'confirmed',
        code: null,
        status: 200,
        detail: 'written',
        coalesced: false,
      });
    });

    it('a refused write is not retried', async () => {
      const fetchFn = replyFetch({
        ok: false,
        status: 403,
        text: envelope('pv_write_refused', 'writes are off here'),
      });
      const { service } = connected(fetchFn);
      expect((await service.submit('X', 1)).detail).toBe('writes are off here');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── one in flight per PV, coalescing ──────────────────────────────────────

  describe('one request in flight per PV', () => {
    it('holds a second value until the first settles, then sends it', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { service } = connected(fetchFn);

      const first = track(service.submit('X', 1));
      const second = track(service.submit('X', 2));
      await tick();
      expect(calls.map((c) => c.body.value)).toEqual([1]);

      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(first.value?.outcome).toBe('confirmed');
      expect(calls.map((c) => c.body.value)).toEqual([1, 2]);
      expect(second.value).toBeUndefined();

      releases[1]!({ ok: true, status: 200 });
      await tick();
      expect(second.value).toEqual({
        outcome: 'confirmed',
        code: null,
        status: 200,
        detail: 'written',
        coalesced: false,
      });
    });

    it('a superseded pending value resolves with the winner outcome, coalesced, and is never sent', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { service } = connected(fetchFn);

      const first = track(service.submit('X', 1));
      const second = track(service.submit('X', 2));
      const third = track(service.submit('X', 3));
      const fourth = track(service.submit('X', 4));
      await tick();
      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(first.value?.coalesced).toBe(false);
      expect(calls.map((c) => c.body.value)).toEqual([1, 4]);

      releases[1]!({
        ok: false,
        status: 409,
        text: envelope('pv_write_mismatch', 'written; the channel holds 3.9'),
      });
      await tick();
      const winner: WriteOutcome = {
        outcome: 'mismatch',
        code: 'pv_write_mismatch',
        status: 409,
        detail: 'written; the channel holds 3.9',
        coalesced: false,
      };
      expect(fourth.value).toEqual(winner);
      expect(second.value).toEqual({ ...winner, coalesced: true });
      expect(third.value).toEqual({ ...winner, coalesced: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('different PVs do not wait on each other', async () => {
      const { fetchFn, calls } = deferredFetch();
      const { service } = connected(fetchFn);
      void service.submit('X', 1);
      void service.submit('Y', 2);
      await tick();
      expect(calls.map((c) => c.url)).toEqual([
        'http://host/hare/v1/pvs/X',
        'http://host/hare/v1/pvs/Y',
      ]);
    });

    it('frees the slot after a settled write', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { service } = connected(fetchFn);
      const a = track(service.submit('X', 1));
      await tick();
      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(a.value?.outcome).toBe('confirmed');
      void service.submit('X', 2);
      await tick();
      expect(calls).toHaveLength(2);
    });
  });

  // ── a pending value's socket or binding changed ──────────────────────────

  describe('pending value dropped', () => {
    it('resolves target_changed with no request when the socket closes', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { service, socket } = connected(fetchFn);
      const first = track(service.submit('X', 1));
      const second = track(service.submit('X', 2));
      const third = track(service.submit('X', 3));
      await tick();

      socket.close();
      await tick();
      expect(third.value).toEqual({
        outcome: 'target_changed',
        code: null,
        status: null,
        detail: TARGET_CHANGED_TEXT,
        coalesced: false,
      });
      expect(second.value).toMatchObject({ outcome: 'target_changed', coalesced: true });

      // The request already sent still reports its own outcome.
      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(first.value?.outcome).toBe('confirmed');
      expect(calls).toHaveLength(1);
    });

    it('resolves target_changed with no request when the heartbeat binding changes', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { service, socket } = connected(fetchFn);
      void service.submit('X', 1);
      const second = track(service.submit('X', 2, { binding: BINDING }));
      await tick();

      socket.message(heartbeatFrame('va@4'));
      await tick();
      expect(second.value?.outcome).toBe('target_changed');

      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(calls).toHaveLength(1);
    });

    it('keeps a pending value across an unchanged heartbeat', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { service, socket } = connected(fetchFn);
      void service.submit('X', 1);
      void service.submit('X', 2);
      await tick();
      socket.message(heartbeatFrame(BINDING));
      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(calls.map((c) => c.body)).toEqual([
        { value: 1, binding: BINDING },
        { value: 2, binding: BINDING },
      ]);
    });

    it('drops a pending value whose socket was replaced while the request ran', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        fetchFn,
        reconnectDelaysMs: [5],
      });
      service.connect();
      instances[0]!.open();
      instances[0]!.message(heartbeatFrame(BINDING));
      void service.submit('X', 1);
      const second = track(service.submit('X', 2));
      await tick();
      instances[0]!.close();
      await vi.advanceTimersByTimeAsync(5);
      instances[1]!.open();
      instances[1]!.message(heartbeatFrame(BINDING));
      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(second.value?.outcome).toBe('target_changed');
      expect(calls).toHaveLength(1);
    });
  });

  // ── put time budget ──────────────────────────────────────────────────────

  describe('putTimeoutMs', () => {
    it('resolves unknown 35000 ms after the send and holds the slot until the request settles', async () => {
      const { fetchFn, calls, releases } = deferredFetch();
      const { service } = connected(fetchFn);

      const first = track(service.submit('X', 1));
      await vi.advanceTimersByTimeAsync(34_999);
      expect(first.value).toBeUndefined();
      const second = track(service.submit('X', 2));
      await vi.advanceTimersByTimeAsync(1);
      expect(first.value).toEqual({
        outcome: 'unknown',
        code: null,
        status: null,
        detail: UNKNOWN_TEXT,
        coalesced: false,
      });

      // The slot is still held: the second value waits for the first fetch.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toHaveLength(1);
      expect(second.value).toBeUndefined();

      // A late reply does not change the first outcome; then the second is sent.
      releases[0]!({ ok: true, status: 200 });
      await tick();
      expect(first.value?.outcome).toBe('unknown');
      expect(calls.map((c) => c.body.value)).toEqual([1, 2]);

      // Its own budget is timed from its own send.
      await vi.advanceTimersByTimeAsync(34_999);
      expect(second.value).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(second.value?.outcome).toBe('unknown');
    });

    it('honours a configured putTimeoutMs', async () => {
      const { fetchFn } = deferredFetch();
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        fetchFn,
        putTimeoutMs: 1000,
      });
      service.connect();
      instances[0]!.open();
      instances[0]!.message(heartbeatFrame(BINDING));
      const got = track(service.submit('X', 1));
      await vi.advanceTimersByTimeAsync(1000);
      expect(got.value?.outcome).toBe('unknown');
    });
  });

  // ── write()/put() unchanged ──────────────────────────────────────────────

  it('leaves write() as it was: no binding, no origin, no heartbeat needed', async () => {
    const fetchFn = replyFetch({ ok: true, status: 200 });
    const service = new HarePVService({ url: BASE_URL, fetchFn });
    await service.write('X', 1);
    expect(fetchFn.mock.calls[0]![1].body).toBe('{"value":1}');
  });
});
