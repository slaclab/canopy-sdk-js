// Wire DTOs for the Canopy Formula Engine's live formula protocol
// (WS /formula-engine/v1/ws/formulas).
//
// These mirror Canopy's Python contracts (`canopy.contracts.formula`,
// `canopy.formula_engine.api.v1.ws`), whose pydantic base (`CanopyModel`)
// serializes snake_case field names to camelCase on the wire.

import type { WireAlarmSeverity } from '../wire.js';

export type FormulaKind = 'scalar' | 'timeseries' | 'waveform' | 'table';
export type FormulaMode = 'raw' | 'binned';
export type AlignmentMode = 'last' | 'interpolate';
export type IndexMode = 'union' | 'intersection' | 'grid' | 'first_input';
/** Trigger edge of a `'first_input'` table (`canopy.contracts.formula.TriggerEdge`). */
export type TriggerEdge = 'rising' | 'falling';

/**
 * A complete formula request (`canopy.contracts.formula.FormulaSpec`).
 * Optional fields fall back to the server defaults noted below.
 */
export interface FormulaSpec {
  kind: FormulaKind;
  /**
   * Expression over the binding tokens, e.g. `"A + B * 2"`. Required for
   * every kind except `'table'`, where it must be absent (each column carries
   * its own expression in `columns`).
   */
  expression?: string;
  /** Binding token -> PV name. */
  bindings: Record<string, string>;
  /** Server default: `'raw'`. */
  mode?: FormulaMode;
  /** Server default: `'last'`. */
  align?: AlignmentMode;
  /** Server default: `'union'`. */
  index?: IndexMode;
  /** Grid step in nanoseconds; must be > 0 when provided. */
  gridDtNs?: number | null;
  /**
   * Decimation cap; must be > 0 when provided. For `'table'`, the number of
   * rows N kept (1-10 000, server default 1000).
   */
  maxPoints?: number | null;
  /**
   * `'table'` only: column name -> expression over `{binding}` tokens, e.g.
   * `{ x: '{x}', y: '{y} * 1000' }`. Forbidden for the other kinds.
   */
  columns?: Record<string, string> | null;
  /**
   * `'table'` only: the binding token whose updates emit a row. Required when
   * `index` is `'first_input'`, forbidden when it is `'grid'`. A trigger
   * binding need not appear in any column.
   */
  trigger?: string | null;
  /**
   * `'table'` only, and only when `index` is `'first_input'`: emit a row on a
   * rising or falling edge of the trigger binding. Absent means every trigger
   * update emits a row. The server rejects it with any other `index`.
   */
  triggerEdge?: TriggerEdge;
}

export interface ScalarResultDTO {
  tsNs: number;
  value: number | boolean | string;
  severity: WireAlarmSeverity;
  /** Binding token -> timestamp (ns) of the input sample used. */
  inputsUsed: Record<string, number>;
}

export interface TimeseriesResultDTO {
  tsNs: number[];
  values: (number | null)[];
  severity: WireAlarmSeverity[];
  /** Binding token -> PV name. */
  inputs: Record<string, string>;
  decimated: boolean;
}

export interface WaveformResultDTO {
  tsNs: number;
  values: number[];
  severity: WireAlarmSeverity;
}

/**
 * How much of a `'table'` input's window history the server could seed
 * (`canopy.contracts.formula.TableHistory`).
 */
export type TableHistory = 'seeded' | 'live-only' | 'not-archived' | 'truncated';

/** Whether a `'table'` input has produced any sample yet (`TableInputState`). */
export type TableInputState = 'ok' | 'no-data';

/** Per-binding state of a `'table'` result (`canopy.contracts.formula.TableInput`). */
export interface TableInputDTO {
  history: TableHistory;
  status: TableInputState;
  /**
   * True while this input delivered a sample late, or its IOC clock was seen
   * to skew, within the last 60 s of the server's receive clock (a state, not
   * a count). Optional on the wire; {@link FormulaEngineService} delivers it as
   * `false` when a frame omits it.
   */
  lateAfterFinal?: boolean;
}

/** A `'table'` result (`canopy.contracts.formula.TableResult`). */
export interface TableResultDTO {
  /** Row timestamps (epoch ns), oldest first. */
  tsNs: number[];
  /** Column name -> one value per row; `null` where the column has no value. */
  columns: Record<string, (number | null)[]>;
  /** Binding token -> input state (includes a trigger binding that is no column). */
  inputs: Record<string, TableInputDTO>;
  /** Rows the server holds for the window; more than `tsNs.length` when capped by `maxPoints`. */
  totalRows: number;
}

/**
 * Tagged union by `kind`: exactly the matching member is non-null. `table`
 * frames may carry only `{ kind, table }`, without the null siblings.
 */
export interface FormulaResultDTO {
  kind: FormulaKind;
  scalar: ScalarResultDTO | null;
  timeseries: TimeseriesResultDTO | null;
  waveform: WaveformResultDTO | null;
  table?: TableResultDTO | null;
}

// ── Client -> server messages on WS /formula-engine/v1/ws/formulas ──────────────

export interface FormulaEngineSubscribeMessage {
  type: 'subscribe';
  spec: FormulaSpec;
  /** Window start (epoch ns). Server default 0. */
  t0Ns?: number;
  /**
   * Window end (epoch ns). Server default 0 = "now", which makes the
   * subscription live (re-evaluated on input changes). Non-zero requests a
   * fixed historical window: one result, then a `completed` frame.
   */
  t1Ns?: number;
  /** When > 0, the server re-evaluates on this timer instead of on PV change. */
  intervalMs?: number;
}

export interface FormulaEngineUnsubscribeMessage {
  type: 'unsubscribe';
  /** The server-assigned subscription id from the `subscribed` frame. */
  id: string;
}

export interface FormulaEnginePingMessage {
  type: 'ping';
}

export type FormulaEngineClientMessage =
  | FormulaEngineSubscribeMessage
  | FormulaEngineUnsubscribeMessage
  | FormulaEnginePingMessage;

// ── Server -> client frames ──────────────────────────────────────────────────

/** Acknowledges one `subscribe`, carrying the server-assigned subscription id. */
export interface FormulaEngineSubscribedFrame {
  type: 'subscribed';
  id: string;
}

export interface FormulaEngineResultFrame {
  type: 'result';
  id: string;
  data: FormulaResultDTO;
}

/** Sent after the single result of a fixed-window (`t1Ns` != 0) evaluation. */
export interface FormulaEngineCompletedFrame {
  type: 'completed';
  id: string;
}

/**
 * `id` is present when the error belongs to an established subscription;
 * absent when it is the (negative) reply to the oldest in-flight `subscribe`
 * (e.g. an invalid spec) or a connection-level protocol error.
 */
export interface FormulaEngineErrorFrame {
  type: 'error';
  id?: string;
  code: string;
  message: string;
  /**
   * True when the condition is transient (e.g. an input not buffered yet, an
   * archiver timeout) and the subscription stays live; false for a terminal
   * reject such as an invalid spec. Missing on older servers = false.
   */
  retryable?: boolean;
}

export interface FormulaEnginePongFrame {
  type: 'pong';
  timestamp: number;
}

export type FormulaEngineServerFrame =
  | FormulaEngineSubscribedFrame
  | FormulaEngineResultFrame
  | FormulaEngineCompletedFrame
  | FormulaEngineErrorFrame
  | FormulaEnginePongFrame;
