// @slaclab/canopy-client — framework-free TypeScript client for Canopy's
// protocols: Hare live PVs (WebSocket), Formula Engine formulas (WebSocket),
// Mole history (REST), background jobs (REST), e-log posting (REST), the shared
// REST core, the reconnecting WebSocket they stream over, and typed wire DTOs.

export * from './alarm.js';

export type {
  FetchLike,
  HostBlob,
  HostFormData,
  WebSocketCloseEventLike,
  WebSocketFactory,
  WebSocketLike,
} from './transport.js';

export type {
  ResilientSocketOptions,
  SocketCloseInfo,
  SocketError,
  SocketFrame,
  SocketStatus,
  WsLocationLike,
} from './ws/ResilientSocket.js';
export { ResilientSocket, toWsUrl } from './ws/ResilientSocket.js';

export type {
  AbortSignalLike,
  CanopyAuthErrorCode,
  CanopyConnection,
  CanopyFetchOptions,
  CanopyQueryValue,
  ErrorEnvelope,
  ValidationIssue,
} from './rest/canopyFetch.js';
export { CanopyError, canopyFetch } from './rest/canopyFetch.js';

export * from './time.js';

export * from './wire.js';

export * from './health.js';

export * from './formula-engine/types.js';
export type {
  FormulaEngineConnectionStatus,
  FormulaEngineError,
  FormulaEngineServiceOptions,
  FormulaEngineSubscribeOptions,
} from './formula-engine/FormulaEngineService.js';
export { FormulaEngineService } from './formula-engine/FormulaEngineService.js';

export * from './mole/types.js';
export * from './mole/mole.js';

export * from './jobs/types.js';
export * from './jobs/jobs.js';

export * from './elog/types.js';
export * from './elog/elog.js';

export type { PVData, PVListener, PVService } from './pv/PVService.js';
export { DISCONNECTED_PV } from './pv/PVService.js';
export { MockPVService } from './pv/MockPVService.js';
export { LocalPVService, parseLocUrl } from './pv/LocalPVService.js';
export { RoutedPVService } from './pv/RoutedPVService.js';

export * from './hare/types.js';

export type {
  HareConnectionStatus,
  HareError,
  HarePVServiceOptions,
  HareWriteOptions,
} from './hare/HarePVService.js';
export { HarePVService } from './hare/HarePVService.js';
export type { ClientRowId, WriteOutcomeRow } from './hare/writeOutcome.js';
export {
  WRITE_OUTCOME_COALESCED_TOAST,
  WRITE_OUTCOME_DETAIL_MAX_CHARS,
  WRITE_OUTCOME_ROWS,
  clientOutcome,
  outcomeFromResponse,
} from './hare/writeOutcome.js';
