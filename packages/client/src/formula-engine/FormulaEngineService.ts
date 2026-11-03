import type { WebSocketFactory } from '../transport.js';
import {
  ResilientSocket,
  describeSocketError,
  toServiceStatus,
  toWsUrl,
} from '../ws/ResilientSocket.js';
import type { SocketFrame } from '../ws/ResilientSocket.js';
import type {
  FormulaResultDTO,
  FormulaSpec,
  FormulaEngineServerFrame,
  TableInputDTO,
} from './types.js';

export type FormulaEngineConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface FormulaEngineError {
  code: string;
  message: string;
  /**
   * True when the condition is transient and the subscription stays live
   * (the server keeps evaluating, or the service reconnects); false for a
   * terminal reject. A server frame without the flag reads as false.
   */
  retryable: boolean;
}

export interface FormulaEngineServiceOptions {
  /**
   * Base URL of the Canopy API, e.g. `https://canopy.example.org` — the
   * service connects to `{baseUrl}/formula-engine/v1/ws/formulas` (http(s) is switched
   * to ws(s); a ws(s) base is used as-is). A relative base such as a
   * same-origin dev-proxy prefix (`/api/canopy`) is resolved against
   * `globalThis.location` (see {@link toWsUrl}); without one (Node) the
   * constructor throws, so pass an absolute base or `wsUrl` there.
   */
  baseUrl: string;
  /** Appended as `?api_key=` on the WS URL. */
  apiKey?: string;
  /** Override the full WS endpoint URL (skips derivation from `baseUrl`). */
  wsUrl?: string;
  /** Capped backoff schedule; the attempt counter resets once the server sends a frame on a new connection. Default [1000, 2000, 4000, 8000, 15000]. */
  reconnectDelaysMs?: number[];
  /** Client ping period while connected. Default 15000. */
  pingIntervalMs?: number;
  /** If no server frame arrives within this window after a ping, the socket is considered dead and closed (triggering reconnect). Default 10000. */
  pongTimeoutMs?: number;
  /** Injectable for tests / Node consumers. Default: globalThis.WebSocket. */
  webSocketFactory?: WebSocketFactory;
  /**
   * Close codes after which the service stops reconnecting (status
   * `disconnected`, `onError` with `ws_terminal_close`) until `connect()` is
   * called again. Default `[1008]` (Canopy's "invalid API key", or a key not
   * scoped to this module). Browsers report a rejected handshake as 1006,
   * which never stops the service; pass `[]` to always reconnect.
   */
  terminalCloseCodes?: number[];
  /** Connection-level errors and error frames that match no subscription. */
  onError?: (error: FormulaEngineError) => void;
  onStatusChange?: (status: FormulaEngineConnectionStatus) => void;
}

/** Options accepted by {@link FormulaEngineService.subscribe}. */
export interface FormulaEngineSubscribeOptions {
  /** Window start (epoch ns). Omitted = server default 0. */
  t0Ns?: number;
  /**
   * Window end (epoch ns). Omitted/0 = live subscription (re-evaluated on
   * input changes). Non-zero = fixed historical window: the server sends one
   * result and a `completed` frame (and will re-evaluate once per reconnect
   * while the subscription is held).
   */
  t1Ns?: number;
  /** When > 0, the server re-evaluates on this timer instead of on PV change. */
  intervalMs?: number;
  onResult: (data: FormulaResultDTO) => void;
  /** Errors scoped to this subscription. Falls back to the service-level onError. */
  onError?: (error: FormulaEngineError) => void;
}

interface LocalSubscription {
  spec: FormulaSpec;
  t0Ns: number | undefined;
  t1Ns: number | undefined;
  intervalMs: number | undefined;
  onResult: (data: FormulaResultDTO) => void;
  onError: ((error: FormulaEngineError) => void) | undefined;
  /** Server-assigned id on the *current* socket; null while (re)subscribing. */
  serverId: string | null;
  /** Set when the caller unsubscribed while the subscribe was still in flight. */
  unsubscribed: boolean;
}

/**
 * Live formula evaluation over the Canopy Formula Engine's WebSocket
 * (`WS /formula-engine/v1/ws/formulas`). Knows `FormulaSpec` only — naming conventions
 * and screen-level rule types live in the consuming apps.
 *
 * Subscription ids are **server-assigned**: each `subscribe` frame is
 * answered (in order) by a `subscribed` frame carrying the id used on all
 * later `result`/`error` frames. The service correlates replies to local
 * subscriptions through a FIFO queue, so after a reconnect it re-sends every
 * held subscription and transparently remaps the freshly assigned ids onto
 * the existing callbacks.
 *
 * Framework- and environment-agnostic: takes an injectable
 * `WebSocketFactory`; the connection (capped-backoff reconnect, ping/pong
 * liveness) is a {@link ResilientSocket}, as for `HarePVService`.
 */
export class FormulaEngineService {
  private readonly onErrorCallback: ((error: FormulaEngineError) => void) | undefined;
  private readonly onStatusChangeCallback:
    | ((status: FormulaEngineConnectionStatus) => void)
    | undefined;
  private readonly socket: ResilientSocket;

  /** Every live local subscription, in subscribe order. */
  private subscriptions = new Set<LocalSubscription>();
  /** Subscribe frames sent on the current socket, awaiting `subscribed` replies (FIFO). */
  private pending: LocalSubscription[] = [];
  private byServerId = new Map<string, LocalSubscription>();

  private _status: FormulaEngineConnectionStatus = 'idle';

  constructor(options: FormulaEngineServiceOptions) {
    this.onErrorCallback = options.onError;
    this.onStatusChangeCallback = options.onStatusChange;
    this.socket = new ResilientSocket({
      url: options.wsUrl ?? toWsUrl(options.baseUrl, '/formula-engine/v1/ws/formulas'),
      apiKey: options.apiKey,
      reconnectDelaysMs: options.reconnectDelaysMs,
      pingIntervalMs: options.pingIntervalMs,
      pongTimeoutMs: options.pongTimeoutMs,
      webSocketFactory: options.webSocketFactory,
      terminalCloseCodes: options.terminalCloseCodes,
      label: 'FormulaEngineService',
      onOpen: () => this.resubscribeAll(),
      onFrame: (frame) => this.handleFrame(frame),
      onClose: () => this.handleSocketClose(),
      onStatusChange: (status) => this.setStatus(toServiceStatus(status)),
      onError: (error) =>
        this.reportError({
          code: error.code,
          message: describeSocketError(error, 'formula'),
          // A failed open schedules a reconnect; a terminal close stops the service.
          retryable: error.code === 'ws_connect_failed',
        }),
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._status === 'connected';
  }

  get status(): FormulaEngineConnectionStatus {
    return this._status;
  }

  connect(): void {
    this.socket.connect();
  }

  /**
   * Close the connection and stop reconnecting. Held subscriptions are kept:
   * a later `connect()` re-subscribes them (server ids are re-assigned and
   * remapped, exactly as on an automatic reconnect).
   */
  dispose(): void {
    this.resetServerCorrelation();
    this.socket.close();
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /**
   * Subscribe to live evaluations of `spec`. Returns an idempotent
   * unsubscribe function. May be called before `connect()` or while
   * disconnected — the subscription is (re)sent whenever a socket opens.
   */
  subscribe(spec: FormulaSpec, opts: FormulaEngineSubscribeOptions): () => void {
    const sub: LocalSubscription = {
      spec,
      t0Ns: opts.t0Ns,
      t1Ns: opts.t1Ns,
      intervalMs: opts.intervalMs,
      onResult: opts.onResult,
      onError: opts.onError,
      serverId: null,
      unsubscribed: false,
    };
    this.subscriptions.add(sub);

    // Sent only while the socket is open; otherwise the next open re-sends
    // every held subscription.
    this.sendSubscribe(sub);

    return () => {
      this.unsubscribe(sub);
    };
  }

  private unsubscribe(sub: LocalSubscription): void {
    if (!this.subscriptions.delete(sub)) {
      return; // Already unsubscribed (or dropped after a server-side reject).
    }

    if (sub.serverId !== null) {
      this.byServerId.delete(sub.serverId);
      this.socket.send({ type: 'unsubscribe', id: sub.serverId });
      sub.serverId = null;
      return;
    }

    // No server id yet. If a subscribe frame is in flight, remember the
    // intent: the sub must stay in the pending queue (its slot keeps the
    // FIFO reply correlation aligned) and is unsubscribed server-side the
    // moment its `subscribed` frame arrives.
    if (this.pending.includes(sub)) {
      sub.unsubscribed = true;
    }
  }

  // ── Connection callbacks ──────────────────────────────────────────────────

  /** The socket dropped on its own (an explicit `dispose()` never gets here). */
  private handleSocketClose(): void {
    this.resetServerCorrelation();

    // Every held subscription loses its live evaluation with the socket. Tell
    // each one, so a consumer stops presenting its last result as current;
    // retryable while the service reconnects (the subscription is kept and
    // re-sent on reconnect), not after a terminal close stopped it.
    // Iterate a copy: a callback may unsubscribe.
    const retryable = this.socket.status !== 'closed';
    for (const sub of [...this.subscriptions]) {
      if (!this.subscriptions.has(sub)) continue;
      this.dispatchSubscriptionError(sub, {
        code: 'ws_disconnected',
        message: 'Formula connection lost.',
        retryable,
      });
    }
  }

  /** Server-assigned ids die with their socket; forget all reply correlation. */
  private resetServerCorrelation(): void {
    this.pending = [];
    this.byServerId.clear();
    for (const sub of this.subscriptions) {
      sub.serverId = null;
    }
  }

  /**
   * Re-send a subscribe frame for every held subscription. The server
   * assigns *new* ids; the `subscribed` replies arrive in send order and are
   * remapped onto these local subscriptions through the pending FIFO.
   */
  private resubscribeAll(): void {
    for (const sub of this.subscriptions) {
      this.sendSubscribe(sub);
    }
  }

  // ── Frame handling ────────────────────────────────────────────────────────

  private handleFrame(raw: SocketFrame): void {
    const frame = raw as unknown as FormulaEngineServerFrame;
    switch (frame.type) {
      case 'subscribed':
        this.handleSubscribed(frame.id);
        break;
      case 'result': {
        const sub = this.byServerId.get(frame.id);
        // Unknown id: a frame that raced our unsubscribe. Drop it.
        sub?.onResult(normalizeResult(frame.data));
        break;
      }
      case 'completed':
        // A fixed-window (t1Ns != 0) evaluation finished. The local
        // subscription stays held until the caller unsubscribes.
        break;
      case 'error':
        this.handleErrorFrame(frame.id, {
          code: frame.code,
          message: frame.message,
          retryable: frame.retryable ?? false,
        });
        break;
      case 'pong':
        // Liveness only (the socket already counted it).
        break;
    }
  }

  private handleSubscribed(serverId: string): void {
    // Replies arrive in the order the subscribe frames were sent, so this
    // acknowledges the oldest in-flight subscribe.
    const sub = this.pending.shift();
    if (!sub) return; // Stray ack (protocol hiccup); nothing to correlate.

    if (sub.unsubscribed) {
      // Unsubscribed while the subscribe was in flight: now that the server
      // id exists, immediately release it.
      this.socket.send({ type: 'unsubscribe', id: serverId });
      return;
    }

    sub.serverId = serverId;
    this.byServerId.set(serverId, sub);
  }

  private handleErrorFrame(id: string | undefined, error: FormulaEngineError): void {
    if (id !== undefined) {
      const sub = this.byServerId.get(id);
      if (sub) {
        this.dispatchSubscriptionError(sub, error);
      }
      // Unknown id: raced an unsubscribe; drop like a stray result.
      return;
    }

    // No id. If a subscribe is in flight this is its (negative) reply — the
    // server sends either `subscribed` or an id-less `error` per subscribe,
    // in order. Drop the subscription for good: retrying an invalid spec on
    // every reconnect would just fail again.
    const sub = this.pending.shift();
    if (sub) {
      this.subscriptions.delete(sub);
      if (!sub.unsubscribed) {
        this.dispatchSubscriptionError(sub, error);
      }
      return;
    }

    this.reportError(error);
  }

  private dispatchSubscriptionError(sub: LocalSubscription, error: FormulaEngineError): void {
    if (sub.onError) {
      sub.onError(error);
    } else {
      this.reportError(error);
    }
  }

  // ── Outbound messages ─────────────────────────────────────────────────────

  private sendSubscribe(sub: LocalSubscription): void {
    // JSON.stringify drops undefined members, so omitted options fall back
    // to the server-side defaults.
    const sent = this.socket.send({
      type: 'subscribe',
      spec: sub.spec,
      t0Ns: sub.t0Ns,
      t1Ns: sub.t1Ns,
      intervalMs: sub.intervalMs,
    });
    if (sent) {
      this.pending.push(sub);
    }
  }

  // ── Status / error reporting ──────────────────────────────────────────────

  private setStatus(status: FormulaEngineConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.onStatusChangeCallback?.(status);
  }

  private reportError(error: FormulaEngineError): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    } else {
      console.warn(`[FormulaEngineService] ${error.code}: ${error.message}`);
    }
  }
}

/**
 * Fill wire defaults the server may omit: a `'table'` input without
 * `lateAfterFinal` reads as `false`. Other kinds pass through untouched.
 */
function normalizeResult(data: FormulaResultDTO): FormulaResultDTO {
  const table = data.table;
  if (!table?.inputs) return data;
  const inputs: Record<string, TableInputDTO> = {};
  for (const [binding, input] of Object.entries(table.inputs)) {
    inputs[binding] = { ...input, lateAfterFinal: input.lateAfterFinal ?? false };
  }
  return { ...data, table: { ...table, inputs } };
}
