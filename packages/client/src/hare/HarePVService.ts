import { AlarmSeverity } from '../alarm.js';
import type { PVData, PVListener, PVService } from '../pv/PVService.js';
import { DISCONNECTED_PV } from '../pv/PVService.js';
import { canopyFetch } from '../rest/canopyFetch.js';
import type { FetchLike, WebSocketFactory } from '../transport.js';
import {
  ResilientSocket,
  describeSocketError,
  errorMessage,
  toServiceStatus,
} from '../ws/ResilientSocket.js';
import type { SocketFrame, SocketStatus } from '../ws/ResilientSocket.js';
import type {
  HareAlarmSeverity,
  HareBackend,
  HareHeartbeatFrame,
  HareHeartbeatState,
  HareReachable,
  HareServerFrame,
  HareWrites,
  PVMetaDTO,
  PVValueDTO,
  PVWriteOrigin,
  PVWriteRequestDTO,
  PVWriteResultDTO,
  PVWriteValue,
  SubmitOptions,
  WriteOutcome,
} from './types.js';
import { ValueKind } from './types.js';
import { clientOutcome, outcomeFromResponse } from './writeOutcome.js';

export type { FetchLike, WebSocketFactory, WebSocketLike } from '../transport.js';

export type HareConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface HareError {
  code: string;
  message: string;
}

export interface HarePVServiceOptions {
  /** ws(s):// URL of the live endpoint, e.g. wss://host/hare/v1/ws/pvs */
  url: string;
  /** Appended as ?api_key= on the WS URL; sent as X-API-Key on REST writes. */
  apiKey?: string;
  /** Override the REST endpoint base for writes, e.g. https://host/hare/v1/pvs. Default: derived from `url` (ws->http, wss->https, trailing /ws/pvs -> /pvs, query stripped). */
  httpPvsBaseUrl?: string;
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
  /** Injectable for tests / Node consumers. Default: globalThis.fetch. */
  fetchFn?: FetchLike;
  onError?: (error: HareError) => void;
  onStatusChange?: (status: HareConnectionStatus) => void;
  /**
   * Fired when a heartbeat's backend identity, or its reachability and
   * write-state claims (`reachable`, `writes`), differ from the last ones
   * this socket reported. Every socket's first heartbeat counts, even when
   * it repeats the previous socket's. Fires before the same heartbeat's
   * `onHeartbeat`.
   */
  onBackendChange?: (backend: HareBackend) => void;
  /**
   * Fired whenever `heartbeat()` changes: the current socket's first
   * heartbeat (even when the backend identity is unchanged), a new binding,
   * or the socket closing.
   */
  onHeartbeat?: (state: HareHeartbeatState) => void;
  /** Time budget of one `submit()` request, from the send; past it the outcome is `unknown`. Default 35000. */
  putTimeoutMs?: number;
}

/** Options accepted by {@link HarePVService.write}. */
export interface HareWriteOptions {
  wait?: boolean;
  timeoutS?: number;
}

const DEFAULT_PUT_TIMEOUT_MS = 35000;

/**
 * Most PV names put in one subscribe/unsubscribe frame. Hare silently
 * truncates a subscribe frame past its `max_pvs_per_message` (5000 by
 * default), so larger batches are split well below that.
 */
const MAX_PVS_PER_FRAME = 1000;

type PendingOpType = 'subscribe' | 'unsubscribe';

interface PendingOp {
  type: PendingOpType;
  pvName: string;
  /** Cleared when a later unsubscribe cancels this subscribe before it was sent. */
  live: boolean;
}

/** One `submit()` call waiting for, or holding, its PV's write slot. */
interface QueuedWrite {
  value: PVWriteValue;
  /** Binding sent with the request (null: omitted). */
  binding: string | null;
  origin: PVWriteOrigin | undefined;
  timeoutS: number | undefined;
  /** Sent as `confirmed: true` when a person confirmed the write. */
  confirmed: boolean;
  /** The connection and its heartbeat binding at call time: a pending write is dropped when either changed. */
  connection: number;
  heartbeatBinding: string | null;
  resolve: (outcome: WriteOutcome) => void;
  /** Earlier pending calls this one superseded; they resolve with its outcome, coalesced. */
  superseded: Array<(outcome: WriteOutcome) => void>;
}

/** A PV's write slot: present while one request is in flight; `pending` is the latest value waiting. */
interface WriteSlot {
  pending: QueuedWrite | null;
}

function settleWrite(entry: QueuedWrite, outcome: WriteOutcome): void {
  entry.resolve(outcome);
  for (const resolve of entry.superseded) {
    resolve({ ...outcome, coalesced: true });
  }
}

/** Run `fn` after the current synchronous work, before any timer or I/O callback. */
function scheduleMicrotask(fn: () => void): void {
  const qm = (globalThis as { queueMicrotask?: (cb: () => void) => void }).queueMicrotask;
  if (typeof qm === 'function') {
    qm(fn);
  } else {
    void Promise.resolve().then(fn);
  }
}

const SEVERITY_MAP: Record<HareAlarmSeverity, AlarmSeverity> = {
  NO_ALARM: AlarmSeverity.NO_ALARM,
  MINOR: AlarmSeverity.MINOR,
  MAJOR: AlarmSeverity.MAJOR,
  INVALID: AlarmSeverity.INVALID,
};

/** Derive the default REST write base from the WS URL (ws/wss -> http/https, strip query, /ws/pvs -> /pvs). */
function deriveHttpPvsBaseUrl(wsUrl: string): string {
  let base = wsUrl.split('#')[0]!.split('?')[0]!;
  base = base.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  base = base.replace(/\/ws\/pvs\/?$/i, '/pvs');
  return base;
}

/** Percent-encode each path segment individually so ca://.../pva:// prefixes survive as literal segments. */
function encodePvNameForPath(pvName: string): string {
  return pvName.split('/').map(encodeURIComponent).join('/');
}

function defaultFetchFn(): FetchLike | undefined {
  return (globalThis as { fetch?: FetchLike }).fetch;
}

/**
 * `PVService` implementation over Canopy Hare's live-PV WebSocket
 * (`WS /hare/v1/ws/pvs`) with REST writes (`PUT /hare/v1/pvs/{pv}`).
 *
 * The connection (capped-backoff reconnect, ping/pong liveness, orphaned
 * socket guards) is a {@link ResilientSocket}; this class handles the Hare
 * protocol on top: one `subscribe` frame for every PV with listeners on each
 * (re)open, subscribe/unsubscribe calls batched per tick, `initial`/`diff`
 * frames into `PVData` snapshots, heartbeat frames into the backend identity
 * and the per-socket heartbeat state `submit()` checks, and every listener
 * given a disconnected copy when the socket drops.
 *
 * Framework- and environment-agnostic: takes an injectable `WebSocketFactory`
 * / `FetchLike` so it runs unmodified in browsers, Node, and tests.
 */
export class HarePVService implements PVService {
  private readonly httpPvsBaseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchFn: FetchLike | undefined;
  private readonly onErrorCallback: ((error: HareError) => void) | undefined;
  private readonly onStatusChangeCallback: ((status: HareConnectionStatus) => void) | undefined;
  private readonly onBackendChangeCallback: ((backend: HareBackend) => void) | undefined;
  private readonly onHeartbeatCallback: ((state: HareHeartbeatState) => void) | undefined;
  private readonly putTimeoutMs: number;
  private readonly socket: ResilientSocket;

  private listeners = new Map<string, Set<PVListener>>();
  private snapshots = new Map<string, PVData>();
  private metas = new Map<string, PVMetaDTO>();

  private _status: HareConnectionStatus = 'idle';
  // Identity from the last heartbeat; kept across disconnects (the link
  // state is reported separately through status).
  private backend: HareBackend | null = null;
  // True once the current socket has reported `backend`; a new socket's first
  // heartbeat therefore always counts as a change.
  private backendReported = false;
  // The socket itself lives in ResilientSocket; each open gets a new number,
  // null while no socket is open. Heartbeat state and queued writes compare it
  // to tell the current socket from an earlier one.
  private openCount = 0;
  private connection: number | null = null;
  // The connection that delivered the last heartbeat, and that heartbeat's
  // binding: `heartbeat()` is "seen" only while it is the current open one.
  private heartbeatConnection: number | null = null;
  private heartbeatBinding: string | null = null;
  // One write slot per PV with a submit() request in flight.
  private writeSlots = new Map<string, WriteSlot>();

  // Subscribe/unsubscribe ops issued while the socket is open, in call order,
  // flushed as few frames as possible at the end of the current tick (a screen
  // mounting hundreds of widgets in one commit sends one frame, not hundreds).
  // `pendingByName` holds each name's latest pending op.
  private pendingOps: PendingOp[] = [];
  private pendingByName = new Map<string, PendingOp>();
  private flushScheduled = false;

  constructor(options: HarePVServiceOptions) {
    this.apiKey = options.apiKey;
    this.httpPvsBaseUrl = options.httpPvsBaseUrl ?? deriveHttpPvsBaseUrl(options.url);
    this.fetchFn = options.fetchFn ?? defaultFetchFn();
    this.onErrorCallback = options.onError;
    this.onStatusChangeCallback = options.onStatusChange;
    this.onBackendChangeCallback = options.onBackendChange;
    this.onHeartbeatCallback = options.onHeartbeat;
    this.putTimeoutMs = options.putTimeoutMs ?? DEFAULT_PUT_TIMEOUT_MS;
    this.socket = new ResilientSocket({
      url: options.url,
      apiKey: options.apiKey,
      reconnectDelaysMs: options.reconnectDelaysMs,
      pingIntervalMs: options.pingIntervalMs,
      pongTimeoutMs: options.pongTimeoutMs,
      webSocketFactory: options.webSocketFactory,
      terminalCloseCodes: options.terminalCloseCodes,
      label: 'HarePVService',
      onOpen: () => this.handleOpen(),
      onFrame: (frame) => this.handleFrame(frame),
      onClose: () => this.handleSocketClose(),
      onStatusChange: (status) => this.handleSocketStatus(status),
      onError: (error) =>
        this.reportError({ code: error.code, message: describeSocketError(error, 'live') }),
    });
  }

  // ── PVService lifecycle ────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._status === 'connected';
  }

  get status(): HareConnectionStatus {
    return this._status;
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.close();
    this.clearPending();
    this.connection = null;
    this.forgetHeartbeat();
    this.markAllDisconnected();
  }

  // ── Subscriptions ───────────────────────────────────────────────────────

  subscribe(pvName: string, listener: PVListener): () => void {
    let set = this.listeners.get(pvName);
    const isFirstListener = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.listeners.set(pvName, set);
    }
    set.add(listener);

    let snapshot = this.snapshots.get(pvName);
    if (!snapshot && this._status === 'disconnected') {
      // The link is down: say so at once instead of leaving the PV silent
      // until the next connect.
      snapshot = disconnectedCopy(DISCONNECTED_PV, undefined);
      this.snapshots.set(pvName, snapshot);
    }
    if (snapshot) {
      listener(snapshot);
    }

    // Queued only while a socket is open; otherwise the next open
    // resubscribes every PV with listeners.
    if (isFirstListener && this.connection !== null) {
      this.enqueue('subscribe', pvName);
    }

    return () => {
      const subs = this.listeners.get(pvName);
      if (!subs) return;
      subs.delete(listener);
      if (subs.size === 0) {
        this.listeners.delete(pvName);
        this.snapshots.delete(pvName);
        this.metas.delete(pvName);
        if (this.connection !== null) {
          this.enqueue('unsubscribe', pvName);
        }
      }
    };
  }

  getSnapshot(pvName: string): PVData | undefined {
    return this.snapshots.get(pvName);
  }

  getMeta(pvName: string): PVMetaDTO | undefined {
    return this.metas.get(pvName);
  }

  /** Backend identity of the last heartbeat received, or null before the first one. */
  getBackend(): HareBackend | null {
    return this.backend ? copyBackend(this.backend) : null;
  }

  /**
   * Heartbeat state of the current socket: `seen` once it is open and has
   * delivered a heartbeat, with that heartbeat's binding. Resets on every
   * close. Changes are reported through `onHeartbeat` (a binding change also
   * through `onBackendChange`, a close through `onStatusChange`).
   */
  heartbeat(): HareHeartbeatState {
    const seen =
      this.connection !== null &&
      this.socket.status === 'connected' &&
      this.heartbeatConnection === this.connection;
    return { seen, binding: seen ? this.heartbeatBinding : null };
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget `write()` for the `PVService` interface; a failure is
   * reported through `onError` (`write_failed`).
   *
   * Legacy, unchecked path: see `write()`. Writes a person makes from a screen
   * must go through `submit()`.
   */
  put(pvName: string, value: number | string | boolean): void {
    this.write(pvName, value).catch((err: unknown) => {
      this.reportError({ code: 'write_failed', message: errorMessage(err) });
    });
  }

  /**
   * PUT one value and reject with a `CanopyError` on failure.
   *
   * Legacy, unchecked path, kept for scripts and existing callers. It sends no
   * heartbeat binding (so the server cannot refuse a write aimed at a control
   * target that changed meanwhile), follows redirects, does not serialise
   * writes per PV and does not map the reply to a write outcome. Writes a person
   * makes from a screen must go through `submit()`.
   */
  async write(pvName: string, value: PVWriteValue, options?: HareWriteOptions): Promise<void> {
    const fetchFn = this.fetchFn;
    if (!fetchFn) {
      throw new Error(
        'HarePVService.write: no fetch implementation available (inject `fetchFn` or run in an environment with global fetch).'
      );
    }

    const body: PVWriteRequestDTO = { value };
    if (options?.wait !== undefined) {
      body.wait = options.wait;
    }
    if (options?.timeoutS !== undefined) {
      body.timeout = options.timeoutS;
    }

    // Failures surface as CanopyError carrying the backend's {code, detail}
    // envelope (see ../rest/canopyFetch.ts), which builds the same URL and
    // headers as pvWriteRequest() from this connection and path.
    const { connection, path } = this.pvWriteRequest(pvName);
    await canopyFetch<PVWriteResultDTO | undefined>({ ...connection, fetch: fetchFn }, path, {
      method: 'PUT',
      body,
    });
  }

  /**
   * Write one value with the write-outcome client discipline; never rejects.
   *
   * - Answers `target-changed` with no request unless the current
   *   socket is open and has delivered a heartbeat.
   * - Sends `options.binding`, or else the current heartbeat binding at call
   *   time; a null binding is omitted from the body. Sends `confirmed: true`
   *   when `options.confirmed` is true, else no `confirmed` key.
   * - One request in flight per PV. A value submitted meanwhile waits; a newer
   *   one supersedes it, and the superseded call resolves with the newer one's
   *   outcome and `coalesced: true`. A waiting value whose socket closed or
   *   whose heartbeat binding changed resolves `target-changed` with no request.
   * - Never retries. No reply within `putTimeoutMs` of the send resolves
   *   `client-unknown`; the PV's slot stays held until that request settles.
   */
  submit(pvName: string, value: PVWriteValue, options: SubmitOptions = {}): Promise<WriteOutcome> {
    const hb = this.heartbeat();
    const connection = this.connection;
    if (!hb.seen || connection === null) {
      return Promise.resolve(clientOutcome('target-changed'));
    }
    return new Promise<WriteOutcome>((resolve) => {
      const entry: QueuedWrite = {
        value,
        binding: options.binding !== undefined ? options.binding : hb.binding,
        origin: options.origin,
        timeoutS: options.timeoutS,
        confirmed: options.confirmed === true,
        connection,
        heartbeatBinding: hb.binding,
        resolve,
        superseded: [],
      };
      const slot = this.writeSlots.get(pvName);
      if (!slot) {
        this.writeSlots.set(pvName, { pending: null });
        this.dispatchWrite(pvName, entry);
        return;
      }
      const previous = slot.pending;
      if (previous) {
        entry.superseded = [...previous.superseded, previous.resolve];
      }
      slot.pending = entry;
    });
  }

  /** Send `entry` now (its PV's slot is held) and settle it on reply or timeout. */
  private dispatchWrite(pvName: string, entry: QueuedWrite): void {
    let settled = false;
    const finish = (outcome: WriteOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settleWrite(entry, outcome);
    };
    const timer = setTimeout(() => finish(clientOutcome('client-unknown')), this.putTimeoutMs);
    void this.sendWriteRequest(pvName, entry).then((outcome) => {
      finish(outcome);
      this.releaseWriteSlot(pvName);
    });
  }

  /** The request settled: send the PV's pending value, if it is still valid, or free the slot. */
  private releaseWriteSlot(pvName: string): void {
    const slot = this.writeSlots.get(pvName);
    if (!slot) return;
    const next = slot.pending;
    slot.pending = null;
    if (!next) {
      this.writeSlots.delete(pvName);
      return;
    }
    const hb = this.heartbeat();
    if (!hb.seen || this.connection !== next.connection || hb.binding !== next.heartbeatBinding) {
      this.writeSlots.delete(pvName);
      settleWrite(next, clientOutcome('target-changed'));
      return;
    }
    this.dispatchWrite(pvName, next);
  }

  /** Resolve every waiting value `target-changed` (its socket closed or its binding changed); in-flight requests run on. */
  private dropPendingWrites(keep: (entry: QueuedWrite) => boolean): void {
    for (const slot of this.writeSlots.values()) {
      const entry = slot.pending;
      if (entry && !keep(entry)) {
        slot.pending = null;
        settleWrite(entry, clientOutcome('target-changed'));
      }
    }
  }

  /**
   * Where a PUT of `pvName` goes and how it authenticates, for `write()` (as
   * a connection and path for `canopyFetch`) and `submit()` (as a full URL and
   * JSON headers).
   */
  private pvWriteRequest(pvName: string): {
    connection: { baseUrl: string; apiKey: string | undefined };
    path: string;
    url: string;
    headers: Record<string, string>;
  } {
    const path = `/${encodePvNameForPath(pvName)}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    return {
      connection: { baseUrl: this.httpPvsBaseUrl, apiKey: this.apiKey },
      path,
      url: `${this.httpPvsBaseUrl.replace(/\/+$/, '')}${path}`,
      headers,
    };
  }

  /** One PUT; resolves its write outcome and never rejects. */
  private async sendWriteRequest(pvName: string, entry: QueuedWrite): Promise<WriteOutcome> {
    try {
      const fetchFn = this.fetchFn;
      if (!fetchFn) return clientOutcome('client-unknown');
      const body: PVWriteRequestDTO = { value: entry.value };
      if (entry.timeoutS !== undefined) body.timeout = entry.timeoutS;
      if (entry.binding !== null) body.binding = entry.binding;
      if (entry.origin !== undefined) body.origin = entry.origin;
      if (entry.confirmed) body.confirmed = true;
      const { url, headers } = this.pvWriteRequest(pvName);
      // A redirect is never followed: a login page behind it would read as a 2xx.
      const res = await fetchFn(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
        redirect: 'manual',
      });
      let text = '';
      try {
        text = await res.text();
      } catch {
        // The status alone decides.
      }
      return outcomeFromResponse(res.ok, res.status, text, res.type);
    } catch {
      return clientOutcome('client-unknown');
    }
  }

  // ── Connection callbacks ────────────────────────────────────────────────

  private handleSocketStatus(status: SocketStatus): void {
    this.setStatus(toServiceStatus(status));
    if (status === 'connecting') {
      // Ops queued for a previous socket are void: the new socket's open
      // resubscribes every PV that still has listeners. A new socket has
      // delivered no heartbeat yet.
      this.clearPending();
      this.forgetHeartbeat();
    }
  }

  private handleOpen(): void {
    this.openCount += 1;
    this.connection = this.openCount;
    this.resubscribeAll();
  }

  /** The socket dropped on its own (an explicit `disconnect()` never gets here). */
  private handleSocketClose(): void {
    this.clearPending();
    this.connection = null;
    this.forgetHeartbeat();
    this.markAllDisconnected();
  }

  private resubscribeAll(): void {
    const pvNames = [...this.listeners.keys()];
    if (pvNames.length > 0) {
      this.sendFrames('subscribe', pvNames);
    }
  }

  private markAllDisconnected(): void {
    // The server re-describes every PV on the next subscribe.
    this.metas.clear();
    for (const pvName of this.listeners.keys()) {
      const previous = this.snapshots.get(pvName);
      const data = disconnectedCopy(previous ?? DISCONNECTED_PV, previous?.valueKind);
      this.snapshots.set(pvName, data);
      this.notify(pvName, data);
    }
  }

  // ── Frame handling ──────────────────────────────────────────────────────

  private handleFrame(raw: SocketFrame): void {
    const frame = raw as unknown as HareServerFrame;
    switch (frame.type) {
      case 'initial':
        for (const [pvName, meta] of Object.entries(frame.meta)) {
          // Gate on listeners like applyValue does, so a stray initial for an
          // already-unsubscribed PV cannot park meta in the cache forever.
          if (this.listeners.has(pvName)) {
            this.metas.set(pvName, meta);
          }
        }
        for (const [pvName, dto] of Object.entries(frame.data)) {
          this.applyValue(pvName, dto);
        }
        break;
      case 'diff':
        for (const [pvName, dto] of Object.entries(frame.data)) {
          this.applyValue(pvName, dto);
        }
        break;
      case 'error':
        this.reportError({ code: frame.code, message: frame.message });
        break;
      case 'heartbeat':
        this.applyHeartbeat(frame);
        break;
      case 'pong':
        // Liveness only (the socket already counted it).
        break;
    }
  }

  private applyHeartbeat(frame: HareHeartbeatFrame): void {
    // Older servers omit fields; whatever is missing reads as null.
    const next: HareBackend = {
      name: frame.backend ?? null,
      label: frame.label ?? null,
      notice: frame.notice ?? null,
      binding: frame.binding ?? null,
      reachable: frame.reachable
        ? {
            state: frame.reachable.state,
            since: frame.reachable.since ?? null,
            reason: frame.reachable.reason ?? null,
          }
        : null,
      writes: frame.writes
        ? {
            state: frame.writes.state,
            reason: frame.writes.reason ?? null,
            cause: frame.writes.cause ?? null,
          }
        : null,
    };
    const prev = this.backend;
    if (!this.backendReported || !prev || !sameBackend(prev, next)) {
      this.backend = next;
      this.backendReported = true;
      this.onBackendChangeCallback?.(copyBackend(next));
    }
    this.noteHeartbeat(next.binding);
  }

  /** Record the current socket's heartbeat; drop waiting writes whose binding it changed. */
  private noteHeartbeat(binding: string | null): void {
    const connection = this.connection;
    if (connection === null) return;
    const before = this.heartbeat();
    this.heartbeatConnection = connection;
    this.heartbeatBinding = binding;
    const after = this.heartbeat();
    if (before.seen === after.seen && before.binding === after.binding) return;
    this.dropPendingWrites(
      (entry) => entry.connection === connection && entry.heartbeatBinding === binding
    );
    this.onHeartbeatCallback?.(after);
  }

  /** The current socket is gone: heartbeat unseen, every waiting write dropped. */
  private forgetHeartbeat(): void {
    const wasSeen = this.heartbeatConnection !== null;
    this.backendReported = false;
    this.heartbeatConnection = null;
    this.heartbeatBinding = null;
    this.dropPendingWrites(() => false);
    if (wasSeen) {
      this.onHeartbeatCallback?.({ seen: false, binding: null });
    }
  }

  private applyValue(pvName: string, dto: PVValueDTO): void {
    if (!this.listeners.has(pvName)) {
      // Stray frame for a PV nobody is listening to anymore (e.g. an
      // in-flight diff that arrived just after the last unsubscribe).
      return;
    }

    const meta = this.metas.get(pvName);
    const connected = dto.connected !== false;
    // Fall back to INVALID if the server ever grows a severity we don't know.
    const severity = connected
      ? (SEVERITY_MAP[dto.severity] ?? AlarmSeverity.INVALID)
      : AlarmSeverity.DISCONNECTED;

    const fresh: PVData = {
      value: toPVDataValue(dto.value),
      displayValue: formatDisplayValue(dto, meta),
      severity,
      connected,
      timestamp: Math.floor(dto.tsNs / 1e6),
      units: meta?.units ?? '',
      precision: meta?.precision ?? 0,
      lowerLimit: meta?.displayLow ?? 0,
      upperLimit: meta?.displayHigh ?? 0,
      enumChoices: meta?.enumChoices ?? undefined,
      valueKind: dto.valueKind,
    };
    const data = connected
      ? fresh
      : disconnectedCopy(fresh, this.snapshots.get(pvName)?.valueKind ?? dto.valueKind);

    this.snapshots.set(pvName, data);
    this.notify(pvName, data);
  }

  private notify(pvName: string, data: PVData): void {
    const subs = this.listeners.get(pvName);
    if (!subs) return;
    for (const listener of subs) {
      listener(data);
    }
  }

  // ── Outbound messages ───────────────────────────────────────────────────

  private enqueue(type: PendingOpType, pvName: string): void {
    const latest = this.pendingByName.get(pvName);
    if (type === 'unsubscribe' && latest?.type === 'subscribe') {
      // A subscribe is only issued when the PV had no listeners, so the server
      // does not hold it; dropping the unsent subscribe together with this
      // unsubscribe leaves the server exactly where both frames would.
      latest.live = false;
      this.pendingByName.delete(pvName);
      return;
    }
    const op: PendingOp = { type, pvName, live: true };
    this.pendingOps.push(op);
    this.pendingByName.set(pvName, op);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      scheduleMicrotask(() => this.flushPending());
    }
  }

  private clearPending(): void {
    this.pendingOps = [];
    this.pendingByName.clear();
  }

  /**
   * Send the pending ops in call order, one frame per run of consecutive
   * same-type ops (Hare applies frames strictly in arrival order, so a run
   * never crosses an op of the other type).
   */
  private flushPending(): void {
    this.flushScheduled = false;
    const ops = this.pendingOps;
    this.clearPending();
    // Not open (closed or replaced since enqueue): the reconnect's
    // resubscribeAll covers every PV that still has listeners.
    if (this.connection === null) return;

    let runType: PendingOpType | null = null;
    let run: string[] = [];
    let seen = new Set<string>();
    const emit = () => {
      if (runType && run.length > 0) this.sendFrames(runType, run);
    };
    for (const op of ops) {
      if (!op.live) continue;
      if (op.type !== runType) {
        emit();
        runType = op.type;
        run = [];
        seen = new Set();
      }
      if (!seen.has(op.pvName)) {
        seen.add(op.pvName);
        run.push(op.pvName);
      }
    }
    emit();
  }

  /** Sent only while the socket is open (ResilientSocket.send drops it otherwise). */
  private sendFrames(type: PendingOpType, pvNames: string[]): void {
    for (let i = 0; i < pvNames.length; i += MAX_PVS_PER_FRAME) {
      this.socket.send({ type, pvNames: pvNames.slice(i, i + MAX_PVS_PER_FRAME) });
    }
  }

  // ── Status / error reporting ────────────────────────────────────────────

  private setStatus(status: HareConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.onStatusChangeCallback?.(status);
  }

  private reportError(error: HareError): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    } else {
      console.warn(`[HarePVService] ${error.code}: ${error.message}`);
    }
  }
}

// ── Value / display formatting helpers ──────────────────────────────────────

/**
 * A disconnected copy of `base`: `connected: false`, DISCONNECTED severity,
 * `displayValue` `''` and the empty value of `kind` (waveform `[]`, string
 * `''`, table with no labels or columns, anything else `0`). The last value is
 * never carried over. `kind` becomes the copy's `valueKind`; when it is
 * undefined the copy has no `valueKind` key at all ("unknown"). Other fields
 * (units, limits, timestamp …) come from `base`.
 */
function disconnectedCopy(base: PVData, kind: ValueKind | undefined): PVData {
  const copy: PVData = {
    ...base,
    value: emptyValueOf(kind),
    displayValue: '',
    connected: false,
    severity: AlarmSeverity.DISCONNECTED,
  };
  if (kind === undefined) {
    delete copy.valueKind;
  } else {
    copy.valueKind = kind;
  }
  return copy;
}

function emptyValueOf(kind: ValueKind | undefined): PVData['value'] {
  switch (kind) {
    case ValueKind.WAVEFORM:
      return [];
    case ValueKind.STRING:
      return '';
    case ValueKind.TABLE:
      return { labels: [], columns: [] };
    default:
      return 0;
  }
}

function toPVDataValue(value: PVValueDTO['value']): PVData['value'] {
  if (value === null) return 0;
  return value as PVData['value'];
}

function isTableValue(
  value: PVValueDTO['value']
): value is { labels: string[]; columns: unknown[][] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'labels' in value &&
    'columns' in value
  );
}

function formatDisplayValue(dto: PVValueDTO, meta: PVMetaDTO | undefined): string {
  const { value } = dto;

  // connected:false frames never get here: applyValue makes a disconnected copy.
  if (value === null) {
    return '---';
  }

  if (dto.valueKind === ValueKind.ENUM && typeof value === 'number') {
    const label = meta?.enumChoices?.[value];
    if (label !== undefined) {
      return label;
    }
  }

  if (typeof value === 'number') {
    const formatted = meta?.precision != null ? value.toFixed(meta.precision) : String(value);
    return meta?.units ? `${formatted} ${meta.units}` : formatted;
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `waveform[${value.length}]`;
  }

  if (isTableValue(value)) {
    const rowCount = value.columns[0]?.length ?? 0;
    return `table[${rowCount}x${value.labels.length}]`;
  }

  return String(value);
}

/** A copy whose `reachable` and `writes` objects the caller cannot use to mutate service state. */
function copyBackend(backend: HareBackend): HareBackend {
  return {
    ...backend,
    reachable: backend.reachable ? { ...backend.reachable } : null,
    writes: backend.writes ? { ...backend.writes } : null,
  };
}

function sameBackend(a: HareBackend, b: HareBackend): boolean {
  return (
    a.name === b.name &&
    a.label === b.label &&
    a.notice === b.notice &&
    a.binding === b.binding &&
    sameReachable(a.reachable, b.reachable) &&
    sameWrites(a.writes, b.writes)
  );
}

function sameReachable(a: HareReachable | null, b: HareReachable | null): boolean {
  if (a === null || b === null) return a === b;
  return a.state === b.state && a.since === b.since && a.reason === b.reason;
}

function sameWrites(a: HareWrites | null, b: HareWrites | null): boolean {
  if (a === null || b === null) return a === b;
  return a.state === b.state && a.reason === b.reason && a.cause === b.cause;
}
