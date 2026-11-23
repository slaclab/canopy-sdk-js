// Wire DTOs for the Canopy Formula Engine's live formula protocol
// (WS /formula-engine/v1/ws/formulas).
//
// These mirror Canopy's Python contracts (`canopy.contracts.formula`,
// `canopy.formula_engine.api.v1.ws`), whose pydantic base (`CanopyModel`)
// serializes snake_case field names to camelCase on the wire.

import type { WireAlarmSeverity } from '../wire.js';

export type FormulaKind = 'scalar' | 'timeseries' | 'waveform';
export type FormulaMode = 'raw' | 'binned';
export type AlignmentMode = 'last' | 'interpolate';
export type IndexMode = 'union' | 'intersection' | 'grid' | 'first_input';

/**
 * A complete formula request (`canopy.contracts.formula.FormulaSpec`).
 * Optional fields fall back to the server defaults noted below.
 */
export interface FormulaSpec {
  kind: FormulaKind;
  /** Expression over the binding tokens, e.g. `"A + B * 2"`. */
  expression: string;
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
  /** Decimation cap; must be > 0 when provided. */
  maxPoints?: number | null;
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

/** Tagged union by `kind`: exactly the matching member is non-null. */
export interface FormulaResultDTO {
  kind: FormulaKind;
  scalar: ScalarResultDTO | null;
  timeseries: TimeseriesResultDTO | null;
  waveform: WaveformResultDTO | null;
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
  FormulaEngineSubscribeMessage | FormulaEngineUnsubscribeMessage | FormulaEnginePingMessage;

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
