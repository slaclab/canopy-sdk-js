// Wire DTOs for Canopy's Hare live-PV protocol (WebSocket + REST write).
//
// These mirror Canopy's Python contracts (`canopy.contracts.pv`,
// `canopy.hare.schemas.pv`, `canopy.hare.api.v1.ws`), whose pydantic base
// (`CanopyModel`) serializes snake_case field names to camelCase on the wire.

/** Alarm severity as carried on the wire (a string enum on the Python side). */
export type HareAlarmSeverity = 'NO_ALARM' | 'MINOR' | 'MAJOR' | 'INVALID';

/** How to interpret a `PVValueDTO.value` / `PVMetaDTO.valueKind`. */
export const ValueKind = {
  SCALAR: 'scalar',
  STRING: 'string',
  ENUM: 'enum',
  WAVEFORM: 'waveform',
  TABLE: 'table',
  IMAGE: 'image',
  UNSUPPORTED: 'unsupported',
} as const;
export type ValueKind = (typeof ValueKind)[keyof typeof ValueKind];

/** Column-major NTTable payload: columns[i] holds the cells under labels[i]. */
export interface TableValue {
  labels: string[];
  columns: unknown[][];
}

/** A live wire value: scalar, string, enum index, 1-D waveform, table, or null when disconnected. */
export type PVWireValue = number | boolean | string | unknown[] | TableValue | null;

/** Writable subset accepted by PUT /hare/v1/pvs/{pv}. */
export type PVWriteValue = number | boolean | string | Array<number | boolean | string>;

/** Dynamic per-update payload (every initial/diff frame). */
export interface PVValueDTO {
  pv: string;
  value: PVWireValue;
  valueKind: ValueKind;
  severity: HareAlarmSeverity;
  tsNs: number;
  connected: boolean;
  error: string | null;
}

/**
 * Static per-channel metadata, carried by `initial` frames. All fields
 * nullable. A PV described before it connected gets a second `initial` with
 * its real meta once its first sample arrives (the late-connect re-describe);
 * the newest `initial` wins.
 */
export interface PVMetaDTO {
  pv: string;
  valueKind: ValueKind;
  units: string | null;
  precision: number | null;
  description: string | null;
  enumChoices: string[] | null;
  displayLow: number | null;
  displayHigh: number | null;
  controlLow: number | null;
  controlHigh: number | null;
  warningLow: number | null;
  warningHigh: number | null;
  alarmLow: number | null;
  alarmHigh: number | null;
  writable: boolean | null;
  form: string | null;
}

// ── Server -> client frames on WS /hare/v1/ws/pvs ───────────────────────────

export interface HareInitialFrame {
  type: 'initial';
  data: Record<string, PVValueDTO>;
  meta: Record<string, PVMetaDTO>;
  count: number;
}

export interface HareDiffFrame {
  type: 'diff';
  data: Record<string, PVValueDTO>;
  count: number;
  timestamp: number;
}

/**
 * Why the server cannot serve its bound control target as configured:
 * `fallback` (no control target record, served from the fallback) or
 * `unservable` (the target cannot be served). `null` when bound normally.
 */
export type HareBackendNotice = 'fallback' | 'unservable' | null;

export interface HareHeartbeatFrame {
  type: 'heartbeat';
  timestamp: number;
  backend: string | null;
  /**
   * Display name of the bound control target; null when the server has none.
   * Absent from older servers' heartbeats, which `HarePVService` reads as null.
   */
  label?: string | null;
  /** Absent from older servers' heartbeats, which `HarePVService` reads as null. */
  notice?: HareBackendNotice;
  /**
   * Binding id (`<target>@<generation>`, or the binding state name); null when
   * unbound. Absent from older servers' heartbeats, which `HarePVService` reads
   * as null.
   */
  binding?: string | null;
  /** Whether the machine answers; absent or null when the server makes no claim. */
  reachable?: HareReachable | null;
  /** Whether writes are accepted; absent or null when the server makes no claim. */
  writes?: HareWrites | null;
}

/**
 * A state word this SDK does not know. It is carried through unchanged; a
 * reader treats it as `unknown` for `reachable` and as not `on` for `writes`.
 */
export type HareUnknownStateWord = string & {};

/** Reachability words: `yes` answers, `no` stopped answering, `unknown` not established. */
export type HareReachableState = 'yes' | 'no' | 'unknown';

export interface HareReachable {
  state: HareReachableState | HareUnknownStateWord;
  /** Epoch seconds the current state began; null when not known. */
  since: number | null;
  /** Server sentence explaining the state; null when none. */
  reason: string | null;
}

/**
 * Writes words. `on` and `asked` accept writes (`asked`: a person confirms
 * each one first, and the PUT carries `confirmed: true`); `off`, `locked`,
 * `applying` (the new write state is coming up) and `held` (a watchdog's hold
 * on the session) are inert, as is any unknown word.
 */
export type HareWritesState = 'on' | 'asked' | 'off' | 'locked' | 'applying' | 'held';

export interface HareWrites {
  state: HareWritesState | HareUnknownStateWord;
  /** Server sentence explaining the state; null when none. */
  reason: string | null;
  /** Id of the server's writes-cause row; null when none. */
  cause: string | null;
}

/**
 * Backend identity, plus the server's reachability and write-state claims
 * (`reachable`, `writes`), reported by the last heartbeat, as returned by
 * `HarePVService.getBackend()` and passed to `onBackendChange`.
 */
export interface HareBackend {
  name: string | null;
  label: string | null;
  notice: HareBackendNotice;
  binding: string | null;
  /** Null when the heartbeat carried no reachability claim. */
  reachable: HareReachable | null;
  /** Null when the heartbeat carried no writes claim. */
  writes: HareWrites | null;
}

export interface HarePongFrame {
  type: 'pong';
  timestamp: number;
}

export interface HareErrorFrame {
  type: 'error';
  code: string;
  message: string;
}

export type HareServerFrame =
  | HareInitialFrame
  | HareDiffFrame
  | HareHeartbeatFrame
  | HarePongFrame
  | HareErrorFrame;

// ── Client -> server messages ────────────────────────────────────────────

export interface HareSubscribeMessage {
  type: 'subscribe';
  pvNames: string[];
}

export interface HareUnsubscribeMessage {
  type: 'unsubscribe';
  pvNames: string[];
}

export interface HarePingMessage {
  type: 'ping';
}

export type HareClientMessage = HareSubscribeMessage | HareUnsubscribeMessage | HarePingMessage;

// ── REST write DTOs for PUT /hare/v1/pvs/{pv} ───────────────────────────────

/** The screen and revision that issued a write (recorded in the write's audit record only). */
export interface PVWriteOrigin {
  screen: string;
  rev?: string | null;
}

export interface PVWriteRequestDTO {
  value: PVWriteValue;
  wait?: boolean;
  timeout?: number;
  /** The control-target binding the screen showed; a backend that checks it refuses a PUT naming another. */
  binding?: string;
  origin?: PVWriteOrigin;
  /** True when a person confirmed the write; a backend at `asked` refuses a PUT without it. */
  confirmed?: boolean;
}

export interface PVWriteResultDTO {
  pv: string;
}

// ── Write outcomes ──────────────────────────────────────────────────────────

/** How a write ended, as the write-outcome contract names it. */
export type WriteOutcomeKind =
  | 'confirmed'
  | 'mismatch'
  | 'unconfirmed'
  | 'unknown'
  | 'refused'
  | 'target_changed'
  | 'switch_in_progress';

/**
 * What `HarePVService.submit()` resolves to: one write-outcome row. `detail` is always
 * toast-ready text (never a raw response body). `status`/`code` are the HTTP
 * status and envelope code when a response arrived, else null. `coalesced` is
 * true when a newer value for the same PV superseded this one before it was
 * sent: the outcome is then the newer value's, and this value was never sent.
 */
export interface WriteOutcome {
  outcome: WriteOutcomeKind;
  code: string | null;
  status: number | null;
  detail: string;
  coalesced: boolean;
}

/** Options accepted by `HarePVService.submit()`. */
export interface SubmitOptions {
  /** Screen and revision for the audit record. */
  origin?: PVWriteOrigin;
  /**
   * Binding to send (captured when a confirmation dialog opened). Omitted:
   * the current socket's heartbeat binding at call time. Null is never sent.
   */
  binding?: string | null;
  /** Sent as the request's `timeout`; never weakens the server's confirm policy. */
  timeoutS?: number;
  /** True when a person confirmed this write in a dialog: sent as `confirmed: true`. */
  confirmed?: boolean;
}

/** Per-socket heartbeat state, as returned by `HarePVService.heartbeat()`. */
export interface HareHeartbeatState {
  /** True once the current socket is open and has delivered a heartbeat. */
  seen: boolean;
  /** That heartbeat's binding; null when unseen or unbound. */
  binding: string | null;
}
