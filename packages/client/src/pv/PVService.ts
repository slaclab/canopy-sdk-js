import type { AlarmSeverity } from '../alarm.js';
import type {
  HareHeartbeatState,
  PVWriteValue,
  SubmitOptions,
  TableValue,
  ValueKind,
  WriteOutcome,
} from '../hare/types.js';

// ── PV Data Types ───────────────────────────────────────────────────────────

export interface PVData {
  // Waveform PVs arrive as arrays (number[] / string[]); NTTable PVs arrive as
  // a TableValue.
  value: number | string | boolean | number[] | string[] | TableValue;
  displayValue: string;
  severity: AlarmSeverity;
  connected: boolean;
  timestamp: number;
  units: string;
  precision: number;
  lowerLimit: number;
  upperLimit: number;
  /** Enum state labels (mbbo/bo choices) when the PV is enum-kind; undefined otherwise. */
  enumChoices?: string[];
  /**
   * The value's kind as last reported by the source (a Hare diff/initial, or
   * the type a local/mock service stored). A disconnected copy keeps the
   * previous snapshot's kind, else the kind of the frame that reported the
   * disconnect, and holds the empty value of that kind (waveform `[]`, string
   * `''`, table with no labels or columns, anything else `0`). Absent when
   * neither is known — `DISCONNECTED_PV` itself never carries one — so a
   * missing kind is "unknown", never an implied `'scalar'`.
   */
  valueKind?: ValueKind;
}

export type PVListener = (data: PVData) => void;

// ── PV Service Interface ────────────────────────────────────────────────────

export interface PVService {
  subscribe(pvName: string, listener: PVListener): () => void;
  put(pvName: string, value: number | string | boolean): void;
  /**
   * Write one value and resolve its write outcome; never rejects. The checked
   * path for writes a person makes from a screen (see `HarePVService.submit()`).
   * Optional: a service without it has no checked writes. `LocalPVService`
   * and `MockPVService` apply the value in memory and resolve at once.
   */
  submit?(pvName: string, value: PVWriteValue, options?: SubmitOptions): Promise<WriteOutcome>;
  /**
   * Heartbeat state of the service's control-target link (see
   * `HarePVService.heartbeat()`). Only a service with a control target has one.
   */
  heartbeat?(): HareHeartbeatState;
  getSnapshot(pvName: string): PVData | undefined;
  connect(): void;
  disconnect(): void;
  readonly isConnected: boolean;
}

export const DISCONNECTED_PV: PVData = {
  value: 0,
  displayValue: '---',
  severity: 4, // DISCONNECTED
  connected: false,
  timestamp: 0,
  units: '',
  precision: 0,
  lowerLimit: 0,
  upperLimit: 0,
};
