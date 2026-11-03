import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebSocketFactory } from '../testing/fakeWebSocket.js';
import { FormulaEngineService } from './FormulaEngineService.js';
import type { FormulaEngineError } from './FormulaEngineService.js';
import type { FormulaResultDTO, FormulaSpec } from './types.js';

const BASE_URL = 'https://host';

function makeSpec(overrides: Partial<FormulaSpec> = {}): FormulaSpec {
  return {
    kind: 'scalar',
    expression: 'A + B',
    bindings: { A: 'PV:A', B: 'PV:B' },
    ...overrides,
  };
}

function makeResult(value: number): FormulaResultDTO {
  return {
    kind: 'scalar',
    scalar: { tsNs: 1_000_000, value, severity: 'NO_ALARM', inputsUsed: { A: 1, B: 1 } },
    timeseries: null,
    waveform: null,
  };
}

describe('FormulaEngineService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Connection wire-up ────────────────────────────────────────────────────

  describe('connect', () => {
    it('derives the ws(s) endpoint from baseUrl and appends ?api_key=', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        apiKey: 'secret-key',
        webSocketFactory: factory,
      });

      service.connect();

      expect(instances).toHaveLength(1);
      expect(instances[0]!.url).toBe('wss://host/formula-engine/v1/ws/formulas?api_key=secret-key');
    });

    it('uses a ws:// baseUrl as-is and honors the wsUrl override', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      new FormulaEngineService({ baseUrl: 'ws://host/', webSocketFactory: factory }).connect();
      expect(instances[0]!.url).toBe('ws://host/formula-engine/v1/ws/formulas');

      new FormulaEngineService({
        baseUrl: BASE_URL,
        wsUrl: 'wss://elsewhere/formula-engine/v1/ws/formulas',
        webSocketFactory: factory,
      }).connect();
      expect(instances[1]!.url).toBe('wss://elsewhere/formula-engine/v1/ws/formulas');
    });

    it('resolves a relative baseUrl (a dev-proxy prefix) against the page location', () => {
      vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173', pathname: '/' });
      try {
        const { factory, instances } = createFakeWebSocketFactory();
        new FormulaEngineService({ baseUrl: '/api/canopy', webSocketFactory: factory }).connect();
        expect(instances[0]!.url).toBe(
          'ws://localhost:5173/api/canopy/formula-engine/v1/ws/formulas'
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('does not resolve baseUrl when wsUrl overrides it', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      // A relative base with no location would throw if it were resolved.
      new FormulaEngineService({
        baseUrl: '/api/canopy',
        wsUrl: 'ws://host/formula-engine/v1/ws/formulas',
        webSocketFactory: factory,
      }).connect();
      expect(instances[0]!.url).toBe('ws://host/formula-engine/v1/ws/formulas');
    });
  });

  // ── Subscribe / result routing ────────────────────────────────────────────

  describe('subscribe + result routing', () => {
    it('sends nothing before the socket opens, then one subscribe frame with only the provided options', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });

      service.connect();
      service.subscribe(makeSpec(), { t0Ns: 123, onResult: vi.fn() });

      const socket = instances[0]!;
      expect(socket.sent).toHaveLength(0);

      socket.open();

      // t1Ns / intervalMs were omitted, so they are absent from the frame
      // (the server then applies its own defaults).
      expect(socket.parsedSent()).toEqual([{ type: 'subscribe', spec: makeSpec(), t0Ns: 123 }]);
    });

    it('remaps the server-assigned id onto the local subscription and routes results by id', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onResultA = vi.fn();
      const onResultB = vi.fn();
      service.subscribe(makeSpec({ expression: 'A' }), { onResult: onResultA });
      service.subscribe(makeSpec({ expression: 'B' }), { onResult: onResultB });

      // The server acknowledges in send order.
      socket.message({ type: 'subscribed', id: 'srv-a' });
      socket.message({ type: 'subscribed', id: 'srv-b' });

      socket.message({ type: 'result', id: 'srv-b', data: makeResult(2) });
      socket.message({ type: 'result', id: 'srv-a', data: makeResult(1) });
      socket.message({ type: 'result', id: 'unknown', data: makeResult(3) }); // stray: dropped

      expect(onResultA).toHaveBeenCalledExactlyOnceWith(makeResult(1));
      expect(onResultB).toHaveBeenCalledExactlyOnceWith(makeResult(2));
    });

    it('a completed frame (fixed-window one-shot) is accepted and keeps the subscription held', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onResult = vi.fn();
      service.subscribe(makeSpec(), { t0Ns: 1, t1Ns: 2, onResult });
      socket.message({ type: 'subscribed', id: 'srv-1' });
      socket.message({ type: 'result', id: 'srv-1', data: makeResult(42) });
      socket.message({ type: 'completed', id: 'srv-1' });

      expect(onResult).toHaveBeenCalledExactlyOnceWith(makeResult(42));
    });
  });

  // ── Unsubscribe ───────────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('sends an unsubscribe with the server id and drops later results', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onResult = vi.fn();
      const unsubscribe = service.subscribe(makeSpec(), { onResult });
      socket.message({ type: 'subscribed', id: 'srv-1' });

      socket.sent.length = 0;
      unsubscribe();
      expect(socket.parsedSent()).toEqual([{ type: 'unsubscribe', id: 'srv-1' }]);

      socket.message({ type: 'result', id: 'srv-1', data: makeResult(1) }); // raced frame
      expect(onResult).not.toHaveBeenCalled();

      unsubscribe(); // idempotent
      expect(socket.parsedSent()).toHaveLength(1);
    });

    it('unsubscribing while the subscribe is still in flight releases the id as soon as it is assigned', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onResultA = vi.fn();
      const onResultB = vi.fn();
      const unsubscribeA = service.subscribe(makeSpec({ expression: 'A' }), {
        onResult: onResultA,
      });
      service.subscribe(makeSpec({ expression: 'B' }), { onResult: onResultB });

      unsubscribeA(); // no server id yet: nothing to send at this point
      socket.sent.length = 0;

      // A's slot still consumes the first ack, keeping B's correlation intact.
      socket.message({ type: 'subscribed', id: 'srv-a' });
      expect(socket.parsedSent()).toEqual([{ type: 'unsubscribe', id: 'srv-a' }]);

      socket.message({ type: 'subscribed', id: 'srv-b' });
      socket.message({ type: 'result', id: 'srv-b', data: makeResult(2) });
      socket.message({ type: 'result', id: 'srv-a', data: makeResult(1) });

      expect(onResultA).not.toHaveBeenCalled();
      expect(onResultB).toHaveBeenCalledExactlyOnceWith(makeResult(2));
    });
  });

  // ── Reconnect + id remap ──────────────────────────────────────────────────

  describe('reconnect', () => {
    it('re-sends every held subscription with backoff and remaps the newly assigned server ids', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();

      const onResultA = vi.fn();
      const onResultB = vi.fn();
      service.subscribe(makeSpec({ expression: 'A' }), { t0Ns: 10, onResult: onResultA });
      service.subscribe(makeSpec({ expression: 'B' }), { intervalMs: 500, onResult: onResultB });

      const socket1 = instances[0]!;
      socket1.open();
      socket1.message({ type: 'subscribed', id: 'old-a' });
      socket1.message({ type: 'subscribed', id: 'old-b' });
      socket1.message({ type: 'result', id: 'old-a', data: makeResult(1) });
      expect(onResultA).toHaveBeenCalledTimes(1);

      socket1.close();

      // First backoff delay is 1000ms.
      expect(instances).toHaveLength(1);
      vi.advanceTimersByTime(999);
      expect(instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(instances).toHaveLength(2);

      const socket2 = instances[1]!;
      socket2.open();

      // Both subscriptions re-sent, in original subscribe order.
      expect(socket2.parsedSent()).toEqual([
        { type: 'subscribe', spec: makeSpec({ expression: 'A' }), t0Ns: 10 },
        { type: 'subscribe', spec: makeSpec({ expression: 'B' }), intervalMs: 500 },
      ]);

      // The server assigns fresh ids; replies arrive in send order and are
      // remapped onto the existing local subscriptions.
      socket2.message({ type: 'subscribed', id: 'new-a' });
      socket2.message({ type: 'subscribed', id: 'new-b' });

      socket2.message({ type: 'result', id: 'new-a', data: makeResult(11) });
      socket2.message({ type: 'result', id: 'new-b', data: makeResult(22) });
      socket2.message({ type: 'result', id: 'old-a', data: makeResult(99) }); // dead id: dropped

      expect(onResultA).toHaveBeenCalledTimes(2);
      expect(onResultA).toHaveBeenLastCalledWith(makeResult(11));
      expect(onResultB).toHaveBeenCalledExactlyOnceWith(makeResult(22));
    });

    it('grows the backoff delay when a reconnect attempt itself fails to open', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      service.subscribe(makeSpec(), { onResult: vi.fn() });

      instances[0]!.open();
      instances[0]!.close();

      vi.advanceTimersByTime(1000);
      expect(instances).toHaveLength(2);

      // The second socket closes again without ever opening.
      instances[1]!.close();

      // Second backoff delay is 2000ms (delays[1]).
      vi.advanceTimersByTime(1999);
      expect(instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(instances).toHaveLength(3);
    });
  });

  // ── Socket loss ───────────────────────────────────────────────────────────

  describe('ws_disconnected', () => {
    const WS_DISCONNECTED = {
      code: 'ws_disconnected',
      message: expect.any(String),
      retryable: true,
    };

    it('dispatches a retryable ws_disconnected error to every held subscription when the socket closes', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const serviceOnError = vi.fn<(error: FormulaEngineError) => void>();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        onError: serviceOnError,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onErrorA = vi.fn<(error: FormulaEngineError) => void>();
      const onErrorB = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(makeSpec({ expression: 'A' }), { onResult: vi.fn(), onError: onErrorA });
      service.subscribe(makeSpec({ expression: 'B' }), { onResult: vi.fn(), onError: onErrorB });
      socket.message({ type: 'subscribed', id: 'srv-a' });
      // B's subscribe is still in flight when the socket drops: it is held all the same.

      socket.close();

      expect(onErrorA).toHaveBeenCalledExactlyOnceWith(WS_DISCONNECTED);
      expect(onErrorB).toHaveBeenCalledExactlyOnceWith(WS_DISCONNECTED);
      expect(serviceOnError).not.toHaveBeenCalled();
      expect(service.status).toBe('disconnected');
    });

    it('falls back to the service-level onError for a subscription without its own onError', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const serviceOnError = vi.fn<(error: FormulaEngineError) => void>();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        onError: serviceOnError,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onErrorA = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(makeSpec({ expression: 'A' }), { onResult: vi.fn(), onError: onErrorA });
      service.subscribe(makeSpec({ expression: 'B' }), { onResult: vi.fn() });
      socket.message({ type: 'subscribed', id: 'srv-a' });
      socket.message({ type: 'subscribed', id: 'srv-b' });

      socket.close();

      expect(onErrorA).toHaveBeenCalledExactlyOnceWith(WS_DISCONNECTED);
      expect(serviceOnError).toHaveBeenCalledExactlyOnceWith(WS_DISCONNECTED);
    });

    it('skips unsubscribed subscriptions and keeps the held ones live across the reconnect', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket1 = instances[0]!;
      socket1.open();

      const onErrorA = vi.fn<(error: FormulaEngineError) => void>();
      const onResultA = vi.fn();
      const onErrorB = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(makeSpec({ expression: 'A' }), { onResult: onResultA, onError: onErrorA });
      const unsubscribeB = service.subscribe(makeSpec({ expression: 'B' }), {
        onResult: vi.fn(),
        onError: onErrorB,
      });
      socket1.message({ type: 'subscribed', id: 'srv-a' });
      socket1.message({ type: 'subscribed', id: 'srv-b' });
      unsubscribeB();

      socket1.close();

      expect(onErrorA).toHaveBeenCalledExactlyOnceWith(WS_DISCONNECTED);
      expect(onErrorB).not.toHaveBeenCalled();

      // The error is retryable: the subscription is re-sent on the next socket.
      vi.advanceTimersByTime(1000);
      const socket2 = instances[1]!;
      socket2.open();
      expect(socket2.parsedSent()).toEqual([
        { type: 'subscribe', spec: makeSpec({ expression: 'A' }) },
      ]);
      socket2.message({ type: 'subscribed', id: 'srv-a2' });
      socket2.message({ type: 'result', id: 'srv-a2', data: makeResult(7) });
      expect(onResultA).toHaveBeenCalledExactlyOnceWith(makeResult(7));
    });

    it('also fires when a socket closes before it ever opened', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      const onError = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(makeSpec(), { onResult: vi.fn(), onError });
      service.connect();

      instances[0]!.close();

      expect(onError).toHaveBeenCalledExactlyOnceWith(WS_DISCONNECTED);
    });

    it('stays silent with no held subscription and on dispose()', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const serviceOnError = vi.fn<(error: FormulaEngineError) => void>();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        onError: serviceOnError,
      });
      service.connect();
      instances[0]!.open();
      instances[0]!.close();
      expect(serviceOnError).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      const socket2 = instances[1]!;
      socket2.open();
      const onError = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(makeSpec(), { onResult: vi.fn(), onError });
      socket2.message({ type: 'subscribed', id: 'srv-1' });

      service.dispose();
      expect(onError).not.toHaveBeenCalled();
      expect(serviceOnError).not.toHaveBeenCalled();
    });
  });

  // ── Error frames ──────────────────────────────────────────────────────────

  describe('error frames', () => {
    it('routes an id-carrying error to that subscription and leaves others alone', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const serviceOnError = vi.fn();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        onError: serviceOnError,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onErrorA = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(makeSpec({ expression: 'A' }), { onResult: vi.fn(), onError: onErrorA });
      const onResultB = vi.fn();
      service.subscribe(makeSpec({ expression: 'B' }), { onResult: onResultB });

      socket.message({ type: 'subscribed', id: 'srv-a' });
      socket.message({ type: 'subscribed', id: 'srv-b' });

      socket.message({ type: 'error', id: 'srv-a', code: 'evaluation_failed', message: 'boom' });
      expect(onErrorA).toHaveBeenCalledExactlyOnceWith({
        code: 'evaluation_failed',
        message: 'boom',
        retryable: false,
      });
      expect(serviceOnError).not.toHaveBeenCalled();

      // The subscription remains live after a transient evaluation error.
      socket.message({ type: 'result', id: 'srv-b', data: makeResult(2) });
      expect(onResultB).toHaveBeenCalledTimes(1);
    });

    it('treats an id-less error as the reply to the oldest in-flight subscribe and drops that subscription for good', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onErrorBad = vi.fn<(error: FormulaEngineError) => void>();
      const onResultGood = vi.fn();
      service.subscribe(makeSpec({ expression: ')(' }), {
        onResult: vi.fn(),
        onError: onErrorBad,
      });
      service.subscribe(makeSpec({ expression: 'B' }), { onResult: onResultGood });

      // Invalid spec: the server answers the first subscribe with an id-less
      // error, then acknowledges the second one.
      socket.message({ type: 'error', code: 'invalid_spec', message: 'invalid spec: )(' });
      socket.message({ type: 'subscribed', id: 'srv-b' });

      expect(onErrorBad).toHaveBeenCalledExactlyOnceWith({
        code: 'invalid_spec',
        message: 'invalid spec: )(',
        retryable: false,
      });
      socket.message({ type: 'result', id: 'srv-b', data: makeResult(2) });
      expect(onResultGood).toHaveBeenCalledTimes(1);

      // The rejected spec is not retried after a reconnect.
      socket.close();
      vi.advanceTimersByTime(1000);
      const socket2 = instances[1]!;
      socket2.open();
      expect(socket2.parsedSent()).toEqual([
        { type: 'subscribe', spec: makeSpec({ expression: 'B' }) },
      ]);
    });

    it('reports an id-less error with no in-flight subscribe to the service-level onError', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const serviceOnError = vi.fn<(error: FormulaEngineError) => void>();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        onError: serviceOnError,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      socket.message({ type: 'error', code: 'invalid_message', message: 'unknown message type' });

      expect(serviceOnError).toHaveBeenCalledExactlyOnceWith({
        code: 'invalid_message',
        message: 'unknown message type',
        retryable: false,
      });
    });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  describe('heartbeat', () => {
    it('pings on the configured interval; a pong disarms the deadline, silence closes and reconnects', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      vi.advanceTimersByTime(1000);
      expect(socket.parsedSent()).toEqual([{ type: 'ping' }]);

      socket.message({ type: 'pong', timestamp: 0 });
      vi.advanceTimersByTime(500);
      expect(socket.readyState).toBe(1); // reply arrived: still open

      vi.advanceTimersByTime(500); // next ping at t=2000
      vi.advanceTimersByTime(500); // no reply -> pong deadline fires
      expect(socket.readyState).toBe(3); // CLOSED

      vi.advanceTimersByTime(1000); // first backoff delay
      expect(instances).toHaveLength(2);
    });
  });

  // ── dispose / status ──────────────────────────────────────────────────────

  describe('dispose', () => {
    it('closes the socket without reconnecting and keeps subscriptions for a later connect()', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({ baseUrl: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const onResult = vi.fn();
      service.subscribe(makeSpec(), { onResult });
      socket.message({ type: 'subscribed', id: 'srv-1' });

      service.dispose();
      expect(socket.readyState).toBe(3); // CLOSED
      expect(service.status).toBe('disconnected');
      expect(service.isConnected).toBe(false);

      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(1); // no reconnect attempted

      service.connect();
      const socket2 = instances[1]!;
      socket2.open();
      expect(socket2.parsedSent()).toEqual([{ type: 'subscribe', spec: makeSpec() }]);

      socket2.message({ type: 'subscribed', id: 'srv-2' });
      socket2.message({ type: 'result', id: 'srv-2', data: makeResult(5) });
      expect(onResult).toHaveBeenCalledExactlyOnceWith(makeResult(5));
    });
  });

  describe('status changes', () => {
    it('fires onStatusChange exactly when the status value changes', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const onStatusChange = vi.fn();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        onStatusChange,
      });

      service.connect();
      instances[0]!.open();
      instances[0]!.close();

      expect(onStatusChange.mock.calls).toEqual([['connecting'], ['connected'], ['disconnected']]);
    });
  });

  describe('terminal close codes', () => {
    it('stops reconnecting after a 1008 close and keeps subscriptions for a later connect()', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const onError = vi.fn<(error: FormulaEngineError) => void>();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        onError,
      });
      service.connect();
      service.subscribe(makeSpec(), { onResult: vi.fn() });
      instances[0]!.open();
      instances[0]!.message({ type: 'subscribed', id: 'srv-1' });

      instances[0]!.close(1008, 'invalid_api_key');

      expect(service.status).toBe('disconnected');
      // The held subscription (no onError of its own) is told its evaluation
      // is gone first, then the service reports the terminal close; neither is
      // retryable because the service no longer reconnects on its own.
      expect(onError.mock.calls).toEqual([
        [{ code: 'ws_disconnected', message: 'Formula connection lost.', retryable: false }],
        [
          {
            code: 'ws_terminal_close',
            message:
              'FormulaEngineService: server closed the connection with code 1008 (invalid_api_key); not reconnecting',
            retryable: false,
          },
        ],
      ]);
      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(1);

      service.connect();
      instances[1]!.open();
      expect(instances[1]!.parsedSent()).toEqual([{ type: 'subscribe', spec: makeSpec() }]);
    });

    it('keeps reconnecting on 1008 when terminalCloseCodes is empty', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new FormulaEngineService({
        baseUrl: BASE_URL,
        webSocketFactory: factory,
        terminalCloseCodes: [],
      });
      service.connect();
      instances[0]!.close(1008);
      vi.advanceTimersByTime(1000);
      expect(instances).toHaveLength(2);
    });
  });
});
