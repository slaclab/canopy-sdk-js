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

/** Static per-channel metadata, sent once on the initial frame. All fields nullable. */
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

export interface HareHeartbeatFrame {
  type: 'heartbeat';
  timestamp: number;
  backend: string | null;
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
  HareInitialFrame | HareDiffFrame | HareHeartbeatFrame | HarePongFrame | HareErrorFrame;

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

export interface PVWriteRequestDTO {
  value: PVWriteValue;
  wait?: boolean;
  timeout?: number;
}

export interface PVWriteResultDTO {
  pv: string;
}
