import type {
  HareHeartbeatState,
  PVWriteValue,
  SubmitOptions,
  WriteOutcome,
} from '../hare/types.js';
import { serviceOutcome } from '../hare/writeOutcome.js';
import type { PVService, PVData, PVListener } from './PVService.js';

/**
 * Scheme router over PVServices: addresses whose scheme matches a route go to
 * that service, everything else to the fallback. The composition root builds
 * one (e.g. `loc://` → LocalPVService, fallback → HarePVService) and hands it
 * to widgets as THE PVService — widgets stay scheme-unaware.
 */
export class RoutedPVService implements PVService {
  private readonly routes: ReadonlyArray<[prefix: string, service: PVService]>;
  private readonly fallback: PVService;

  /**
   * The heartbeat of the fallback, else of the first routed service that has
   * one. Absent when no service here has a heartbeat, as on the services
   * themselves.
   */
  declare readonly heartbeat?: () => HareHeartbeatState;

  constructor(routes: Record<string, PVService>, fallback: PVService) {
    this.routes = Object.entries(routes);
    this.fallback = fallback;
    const beating = [fallback, ...this.routes.map(([, service]) => service)].find(
      (service) => service.heartbeat
    );
    if (beating) this.heartbeat = () => beating.heartbeat!();
  }

  private serviceFor(pvName: string): PVService {
    for (const [prefix, service] of this.routes) {
      if (pvName.startsWith(prefix)) return service;
    }
    return this.fallback;
  }

  subscribe(pvName: string, listener: PVListener): () => void {
    return this.serviceFor(pvName).subscribe(pvName, listener);
  }

  put(pvName: string, value: number | string | boolean): void {
    this.serviceFor(pvName).put(pvName, value);
  }

  /**
   * A checked write through the service `pvName` routes to. A service without
   * `submit` writes nothing and resolves `writes-not-enabled` (its unchecked
   * `put` never stands in for a checked write).
   */
  submit(pvName: string, value: PVWriteValue, options?: SubmitOptions): Promise<WriteOutcome> {
    const service = this.serviceFor(pvName);
    if (!service.submit) return Promise.resolve(serviceOutcome('writes-not-enabled'));
    return service.submit(pvName, value, options);
  }

  getSnapshot(pvName: string): PVData | undefined {
    return this.serviceFor(pvName).getSnapshot(pvName);
  }

  connect(): void {
    for (const [, service] of this.routes) service.connect();
    this.fallback.connect();
  }

  disconnect(): void {
    for (const [, service] of this.routes) service.disconnect();
    this.fallback.disconnect();
  }

  get isConnected(): boolean {
    return this.fallback.isConnected;
  }
}
