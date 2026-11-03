import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlarmSeverity } from '../alarm.js';
import { createFakeWebSocketFactory } from '../testing/fakeWebSocket.js';
import { HarePVService } from './HarePVService.js';
import type { HareError, FetchLike } from './HarePVService.js';
import type {
  HareBackend,
  HareInitialFrame,
  HareDiffFrame,
  HareHeartbeatFrame,
  HareReachable,
  HareWrites,
  HareWritesState,
  PVMetaDTO,
  PVValueDTO,
} from './types.js';
import heartbeatVectorFile from '../../test-vectors/heartbeat_vectors.json' with { type: 'json' };

interface HeartbeatFrameCase {
  case: string;
  frame: HareHeartbeatFrame;
  expected: { reachable: HareReachable | null; writes: HareWrites | null };
}

/** The vendored copy of canopy's heartbeat vectors, narrowed to what the SDK reads. */
const heartbeatVectors = heartbeatVectorFile as unknown as {
  legacy_frame: HeartbeatFrameCase;
  reachable_frames: HeartbeatFrameCase[];
  writes_frames: HeartbeatFrameCase[];
  sequences: {
    id: string;
    steps: { event: 'frame' | 'close'; frame?: HareHeartbeatFrame }[];
  }[];
};

const BASE_URL = 'ws://host/hare/v1/ws/pvs';

function makeMeta(overrides: Partial<PVMetaDTO> = {}): PVMetaDTO {
  return {
    pv: 'X',
    valueKind: 'scalar',
    units: null,
    precision: null,
    description: null,
    enumChoices: null,
    displayLow: null,
    displayHigh: null,
    controlLow: null,
    controlHigh: null,
    warningLow: null,
    warningHigh: null,
    alarmLow: null,
    alarmHigh: null,
    writable: null,
    form: null,
    ...overrides,
  };
}

function makeValue(overrides: Partial<PVValueDTO> = {}): PVValueDTO {
  return {
    pv: 'X',
    value: 0,
    valueKind: 'scalar',
    severity: 'NO_ALARM',
    tsNs: 0,
    connected: true,
    error: null,
    ...overrides,
  };
}

function initialFrame(
  data: Record<string, PVValueDTO>,
  meta: Record<string, PVMetaDTO> = {}
): HareInitialFrame {
  return { type: 'initial', data, meta, count: Object.keys(data).length };
}

/** Let the service's end-of-tick subscribe/unsubscribe flush run. */
async function flushSends(): Promise<void> {
  await Promise.resolve();
}

function diffFrame(data: Record<string, PVValueDTO>): HareDiffFrame {
  return { type: 'diff', data, count: Object.keys(data).length, timestamp: 0 };
}

describe('HarePVService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Connection / subscribe wire-up ────────────────────────────────────────

  describe('connect + subscribe', () => {
    it('appends ?api_key= to the WS URL when apiKey is configured', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        apiKey: 'secret-key',
        webSocketFactory: factory,
      });

      service.connect();

      expect(instances).toHaveLength(1);
      expect(instances[0]!.url).toBe(`${BASE_URL}?api_key=secret-key`);
    });

    it('does not append api_key when none is configured', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });

      service.connect();

      expect(instances[0]!.url).toBe(BASE_URL);
    });

    it('sends nothing when subscribing before the socket opens, then one subscribe message on open', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });

      service.connect();
      service.subscribe('PV1', vi.fn());

      const socket = instances[0]!;
      expect(socket.sent).toHaveLength(0);

      socket.open();

      expect(socket.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['PV1'] }]);
    });
  });

  // ── Frame application ──────────────────────────────────────────────────────

  describe('initial frame application', () => {
    it('delivers PVData mapped from the DTO + meta, and exposes it via getSnapshot/getMeta', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.open();
      listener.mockClear();

      const meta = makeMeta({
        pv: 'PV1',
        units: 'mA',
        precision: 2,
        displayLow: 0,
        displayHigh: 10,
      });
      const value = makeValue({
        pv: 'PV1',
        value: 5.1234,
        severity: 'NO_ALARM',
        tsNs: 1_234_000_000,
        connected: true,
      });
      socket.message(initialFrame({ PV1: value }, { PV1: meta }));

      expect(listener).toHaveBeenCalledTimes(1);
      const data = listener.mock.calls[0]![0];
      expect(data).toEqual({
        value: 5.1234,
        displayValue: '5.12 mA',
        severity: AlarmSeverity.NO_ALARM,
        connected: true,
        timestamp: 1234,
        units: 'mA',
        precision: 2,
        lowerLimit: 0,
        upperLimit: 10,
        valueKind: 'scalar',
      });

      expect(service.getSnapshot('PV1')).toEqual(data);
      expect(service.getMeta('PV1')).toEqual(meta);
    });
  });

  describe('diff frame application', () => {
    it('updates the snapshot and notifies again, reusing meta from the earlier initial frame', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.open();

      const meta = makeMeta({ pv: 'PV1', units: 'V', precision: 1 });
      socket.message(initialFrame({ PV1: makeValue({ pv: 'PV1', value: 1.0 }) }, { PV1: meta }));
      listener.mockClear();

      socket.message(diffFrame({ PV1: makeValue({ pv: 'PV1', value: 2.5, tsNs: 2_000_000 }) }));

      expect(listener).toHaveBeenCalledTimes(1);
      const data = listener.mock.calls[0]![0];
      expect(data.value).toBe(2.5);
      expect(data.displayValue).toBe('2.5 V'); // units survive from the initial frame's meta
      expect(data.timestamp).toBe(2);
      expect(service.getSnapshot('PV1')?.value).toBe(2.5);
    });
  });

  describe('enum and waveform values', () => {
    it('maps an enum value through meta.enumChoices', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.open();

      socket.message(
        initialFrame(
          { PV1: makeValue({ pv: 'PV1', value: 1, valueKind: 'enum' }) },
          { PV1: makeMeta({ pv: 'PV1', valueKind: 'enum', enumChoices: ['OFF', 'ON'] }) }
        )
      );

      const data = listener.mock.calls.at(-1)![0];
      expect(data.value).toBe(1);
      expect(data.displayValue).toBe('ON');
    });

    it('passes waveform arrays through as-is and formats a length-based displayValue', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.open();

      socket.message(
        initialFrame({
          PV1: makeValue({ pv: 'PV1', value: [1, 2, 3], valueKind: 'waveform' }),
        })
      );

      const data = listener.mock.calls.at(-1)![0];
      expect(data.value).toEqual([1, 2, 3]);
      expect(data.displayValue).toBe('waveform[3]');
    });

    it('formats a table value as table[rows x cols]', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.open();

      socket.message(
        initialFrame({
          PV1: makeValue({
            pv: 'PV1',
            value: {
              labels: ['a', 'b'],
              columns: [
                [1, 2],
                [3, 4],
              ],
            },
            valueKind: 'table',
          }),
        })
      );

      const data = listener.mock.calls.at(-1)![0];
      expect(data.value).toEqual({
        labels: ['a', 'b'],
        columns: [
          [1, 2],
          [3, 4],
        ],
      });
      expect(data.displayValue).toBe('table[2x2]');
    });
  });

  describe('severity mapping', () => {
    it('maps MAJOR to AlarmSeverity 2', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.open();

      socket.message(initialFrame({ PV1: makeValue({ pv: 'PV1', severity: 'MAJOR' }) }));

      expect(listener.mock.calls.at(-1)![0].severity).toBe(AlarmSeverity.MAJOR);
    });

    it('forces DISCONNECTED severity and connected:false when the DTO says connected:false', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.open();

      socket.message(
        initialFrame({
          PV1: makeValue({ pv: 'PV1', severity: 'NO_ALARM', connected: false, value: 3 }),
        })
      );

      const data = listener.mock.calls.at(-1)![0];
      expect(data.connected).toBe(false);
      expect(data.severity).toBe(AlarmSeverity.DISCONNECTED);
      // A disconnected copy: the frame's kind, the empty value of that kind.
      expect(data.displayValue).toBe('');
      expect(data.value).toBe(0);
      expect(data.valueKind).toBe('scalar');
    });
  });

  // ── Reconnect / resubscribe ──────────────────────────────────────────────

  describe('reconnect + resubscribe', () => {
    it('marks all subscribed PVs disconnected, reconnects with backoff, and resubscribes everything in one message', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();

      const listenerA = vi.fn();
      const listenerB = vi.fn();
      service.subscribe('A', listenerA);
      service.subscribe('B', listenerB);

      const socket1 = instances[0]!;
      socket1.open();
      socket1.message(
        initialFrame({ A: makeValue({ pv: 'A', value: 1 }), B: makeValue({ pv: 'B', value: 2 }) })
      );
      listenerA.mockClear();
      listenerB.mockClear();

      socket1.close();

      // Every listener notified with connected:false immediately on close.
      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);
      expect(listenerA.mock.calls[0]![0].connected).toBe(false);
      expect(listenerA.mock.calls[0]![0].severity).toBe(AlarmSeverity.DISCONNECTED);
      expect(listenerB.mock.calls[0]![0].connected).toBe(false);
      // The last value is not carried into the disconnected copy.
      expect(listenerA.mock.calls[0]![0]).toMatchObject({ value: 0, displayValue: '' });
      expect(listenerB.mock.calls[0]![0]).toMatchObject({ value: 0, displayValue: '' });

      // First backoff delay is 1000ms.
      expect(instances).toHaveLength(1);
      vi.advanceTimersByTime(999);
      expect(instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(instances).toHaveLength(2);

      const socket2 = instances[1]!;
      socket2.open();

      expect(socket2.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['A', 'B'] }]);

      // A fresh initial frame revives values.
      socket2.message(
        initialFrame({ A: makeValue({ pv: 'A', value: 42 }), B: makeValue({ pv: 'B', value: 43 }) })
      );
      expect(listenerA.mock.calls.at(-1)![0]).toMatchObject({ value: 42, connected: true });
      expect(listenerB.mock.calls.at(-1)![0]).toMatchObject({ value: 43, connected: true });
    });

    it('connect() during a pending reconnect supersedes the timer instead of double-opening', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      service.subscribe('A', vi.fn());

      const socket1 = instances[0]!;
      socket1.open();
      socket1.close(); // schedules a reconnect at +1000ms

      service.connect(); // explicit reconnect supersedes the pending timer
      expect(instances).toHaveLength(2);

      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(2); // the old timer never opened a third socket
    });

    it('grows the backoff delay when a reconnect attempt itself fails to open', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      service.subscribe('A', vi.fn());

      const socket1 = instances[0]!;
      socket1.open();
      socket1.close();

      // First reconnect scheduled for 1000ms.
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

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  describe('heartbeat', () => {
    it('pings on the configured interval and a reply disarms the pong deadline', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      vi.advanceTimersByTime(1000);
      expect(socket.parsedSent()).toEqual([{ type: 'ping' }]);

      // Reply (pong) disarms the deadline; the socket must not be closed by it.
      socket.message({ type: 'pong', timestamp: 0 });
      vi.advanceTimersByTime(500);
      expect(socket.readyState).toBe(1);
    });

    it('closes the socket and schedules a reconnect when no reply follows a ping', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      vi.advanceTimersByTime(1000); // ping sent
      vi.advanceTimersByTime(500); // no reply -> pong deadline fires

      expect(socket.readyState).toBe(3); // CLOSED
      expect(instances).toHaveLength(1);

      vi.advanceTimersByTime(1000); // first backoff delay
      expect(instances).toHaveLength(2);
    });

    it('a heartbeat frame also counts as a reply and disarms the deadline', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500,
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      vi.advanceTimersByTime(1000);
      socket.message({ type: 'heartbeat', timestamp: 0, backend: 'simulation' });
      vi.advanceTimersByTime(500);

      expect(socket.readyState).toBe(1);
    });
  });

  // ── Backend identity (heartbeat label / notice / binding) ─────────────────

  describe('backend identity', () => {
    function heartbeat(fields: Partial<HareHeartbeatFrame> = {}): HareHeartbeatFrame {
      return {
        type: 'heartbeat',
        timestamp: 0,
        backend: 'example-backend',
        label: 'Simulator',
        notice: null,
        binding: 'va@1',
        ...fields,
      };
    }

    function connected(onBackendChange?: (backend: HareBackend) => void) {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        ...(onBackendChange ? { onBackendChange } : {}),
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();
      return { service, socket, instances };
    }

    it('getBackend() is null before the first heartbeat', () => {
      const { service, socket } = connected();
      expect(service.getBackend()).toBeNull();
      // A pong is liveness only and carries no backend.
      socket.message({ type: 'pong', timestamp: 0 });
      expect(service.getBackend()).toBeNull();
    });

    it('getBackend() returns name, label, notice and binding of the last heartbeat', () => {
      const { service, socket } = connected();
      socket.message(heartbeat());
      const expected: HareBackend = {
        name: 'example-backend',
        label: 'Simulator',
        notice: null,
        binding: 'va@1',
        reachable: null,
        writes: null,
      };
      expect(service.getBackend()).toEqual(expected);

      socket.message(heartbeat({ label: 'Rehearsal', notice: 'fallback', binding: 'standin@2' }));
      expect(service.getBackend()).toEqual({
        name: 'example-backend',
        label: 'Rehearsal',
        notice: 'fallback',
        binding: 'standin@2',
        reachable: null,
        writes: null,
      });
    });

    it('carries the unservable token and a state-name binding through', () => {
      const { service, socket } = connected();
      socket.message(heartbeat({ label: 'Machine', notice: 'unservable', binding: 'unservable' }));
      expect(service.getBackend()).toEqual({
        name: 'example-backend',
        label: 'Machine',
        notice: 'unservable',
        binding: 'unservable',
        reachable: null,
        writes: null,
      });
    });

    it('treats fields missing from an older server heartbeat as null', () => {
      const { service, socket } = connected();
      socket.message({ type: 'heartbeat', timestamp: 0, backend: 'simulation' });
      expect(service.getBackend()).toEqual({
        name: 'simulation',
        label: null,
        notice: null,
        binding: null,
        reachable: null,
        writes: null,
      });
    });

    it('fires onBackendChange on change only', () => {
      const onBackendChange = vi.fn();
      const { socket } = connected(onBackendChange);

      socket.message(heartbeat());
      socket.message(heartbeat({ timestamp: 5 })); // timestamp alone is not a change
      socket.message(heartbeat());
      expect(onBackendChange.mock.calls).toEqual([
        [
          {
            name: 'example-backend',
            label: 'Simulator',
            notice: null,
            binding: 'va@1',
            reachable: null,
            writes: null,
          },
        ],
      ]);

      socket.message(heartbeat({ binding: 'va@2' }));
      socket.message(heartbeat({ binding: 'va@2' }));
      socket.message(heartbeat({ binding: 'va@2', notice: 'fallback' }));
      socket.message(heartbeat({ binding: 'va@2', notice: 'fallback', label: 'Rehearsal' }));
      socket.message(
        heartbeat({ binding: 'va@2', notice: 'fallback', label: 'Rehearsal', backend: null })
      );
      expect(onBackendChange.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        {
          name: 'example-backend',
          label: 'Simulator',
          notice: null,
          binding: 'va@1',
          reachable: null,
          writes: null,
        },
        {
          name: 'example-backend',
          label: 'Simulator',
          notice: null,
          binding: 'va@2',
          reachable: null,
          writes: null,
        },
        {
          name: 'example-backend',
          label: 'Simulator',
          notice: 'fallback',
          binding: 'va@2',
          reachable: null,
          writes: null,
        },
        {
          name: 'example-backend',
          label: 'Rehearsal',
          notice: 'fallback',
          binding: 'va@2',
          reachable: null,
          writes: null,
        },
        {
          name: null,
          label: 'Rehearsal',
          notice: 'fallback',
          binding: 'va@2',
          reachable: null,
          writes: null,
        },
      ]);
    });

    it('fires onBackendChange when identity goes all-null after a bound one', () => {
      const onBackendChange = vi.fn();
      const { service, socket } = connected(onBackendChange);
      socket.message(heartbeat());
      socket.message(heartbeat({ label: null, notice: null, binding: null }));
      expect(onBackendChange).toHaveBeenCalledTimes(2);
      expect(service.getBackend()).toEqual({
        name: 'example-backend',
        label: null,
        notice: null,
        binding: null,
        reachable: null,
        writes: null,
      });
    });

    it('keeps the last backend across a reconnect and fires again on the new socket’s first heartbeat', () => {
      const onBackendChange = vi.fn();
      const { service, socket, instances } = connected(onBackendChange);
      socket.message(heartbeat());
      socket.close();
      expect(service.getBackend()).toEqual({
        name: 'example-backend',
        label: 'Simulator',
        notice: null,
        binding: 'va@1',
        reachable: null,
        writes: null,
      });

      vi.advanceTimersByTime(1000);
      instances[1]!.open();
      instances[1]!.message(heartbeat());
      expect(onBackendChange).toHaveBeenCalledTimes(2);
      expect(onBackendChange.mock.calls[1]![0]).toEqual(onBackendChange.mock.calls[0]![0]);

      instances[1]!.message(heartbeat());
      expect(onBackendChange).toHaveBeenCalledTimes(2);

      instances[1]!.message(heartbeat({ binding: 'va@3' }));
      expect(onBackendChange).toHaveBeenCalledTimes(3);
    });

    it('fires again after disconnect() and connect() with an identical heartbeat', () => {
      const onBackendChange = vi.fn();
      const { service, instances } = connected(onBackendChange);
      instances[0]!.message(heartbeat());
      service.disconnect();
      service.connect();
      instances[1]!.open();
      instances[1]!.message(heartbeat());
      expect(onBackendChange).toHaveBeenCalledTimes(2);
    });

    it('fires onBackendChange before onHeartbeat for the same heartbeat', () => {
      const order: string[] = [];
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        onBackendChange: (b) => order.push(`backend:${b.binding}`),
        onHeartbeat: (h) => order.push(`heartbeat:${h.seen}:${h.binding}`),
      });
      service.connect();
      instances[0]!.open();
      instances[0]!.message(heartbeat());
      instances[0]!.message(heartbeat({ binding: 'va@2' }));
      expect(order).toEqual([
        'backend:va@1',
        'heartbeat:true:va@1',
        'backend:va@2',
        'heartbeat:true:va@2',
      ]);
    });

    it('a returned backend is a copy the caller cannot use to mutate service state', () => {
      const { service, socket } = connected();
      socket.message(
        heartbeat({
          reachable: { state: 'yes', since: null, reason: null },
          writes: { state: 'on', reason: null, cause: null },
        })
      );
      const first = service.getBackend()!;
      first.label = 'tampered';
      first.reachable!.state = 'no';
      first.writes!.state = 'off';
      const again = service.getBackend()!;
      expect(again.label).toBe('Simulator');
      expect(again.reachable!.state).toBe('yes');
      expect(again.writes!.state).toBe('on');
    });

    // ── Reachability and write-state claims (reachable / writes), driven by the vector copy

    it('a legacy frame yields reachable and writes null', () => {
      const { service, socket } = connected();
      socket.message(heartbeatVectors.legacy_frame.frame);
      const backend = service.getBackend()!;
      expect(backend.reachable).toBe(heartbeatVectors.legacy_frame.expected.reachable);
      expect(backend.writes).toBe(heartbeatVectors.legacy_frame.expected.writes);
      expect(backend.reachable).toBeNull();
      expect(backend.writes).toBeNull();
    });

    it('a frame with explicit null claims yields reachable and writes null', () => {
      const { service, socket } = connected();
      socket.message(heartbeat({ reachable: null, writes: null }));
      expect(service.getBackend()).toMatchObject({ reachable: null, writes: null });
    });

    it.each([...heartbeatVectors.reachable_frames, ...heartbeatVectors.writes_frames])(
      'vector frame $case reads as its expected claims',
      (frameCase) => {
        const { service, socket } = connected();
        socket.message(frameCase.frame);
        const backend = service.getBackend()!;
        expect(backend.reachable).toEqual(frameCase.expected.reachable);
        expect(backend.writes).toEqual(frameCase.expected.writes);
      }
    );

    it('claim fields missing inside an object read as null', () => {
      const { service, socket } = connected();
      socket.message({
        type: 'heartbeat',
        timestamp: 0,
        backend: 'example-backend',
        reachable: { state: 'no' },
        writes: { state: 'locked' },
      });
      expect(service.getBackend()).toMatchObject({
        reachable: { state: 'no', since: null, reason: null },
        writes: { state: 'locked', reason: null, cause: null },
      });
    });

    it('carries an unknown writes word through, and it does not read as on', () => {
      const { service, socket } = connected();
      socket.message(heartbeat({ writes: { state: 'paused', reason: null, cause: null } }));
      const writes = service.getBackend()!.writes!;
      expect(writes.state).toBe('paused');
      expect(writes.state === 'on').toBe(false);
    });

    it('the writes state union includes applying', () => {
      const state: HareWritesState = 'applying';
      const { service, socket } = connected();
      socket.message(heartbeat({ writes: { state, reason: null, cause: 'applying' } }));
      expect(service.getBackend()!.writes!.state).toBe('applying');
    });

    it.each<[HareWritesState, string]>([
      ['asked', 'asked'],
      ['held', 'session_held'],
    ])('the writes state union includes %s, carried through as said', (state, cause) => {
      const { service, socket } = connected();
      socket.message(heartbeat({ writes: { state, reason: null, cause } }));
      expect(service.getBackend()!.writes).toEqual({ state, reason: null, cause });
    });

    it('fires onBackendChange when any reachable or writes field changes', () => {
      const onBackendChange = vi.fn();
      const { socket } = connected(onBackendChange);
      const yes = { state: 'yes', since: null, reason: null };
      const on = { state: 'on', reason: null, cause: null };
      socket.message(heartbeat({ reachable: yes, writes: on }));
      socket.message(heartbeat({ reachable: { ...yes }, writes: { ...on }, timestamp: 9 }));
      expect(onBackendChange).toHaveBeenCalledTimes(1);

      const steps = [
        { reachable: { ...yes, state: 'no' }, writes: on },
        { reachable: { ...yes, state: 'no', since: 5 }, writes: on },
        { reachable: { ...yes, state: 'no', since: 5, reason: 'r' }, writes: on },
        {
          reachable: { ...yes, state: 'no', since: 5, reason: 'r' },
          writes: { ...on, state: 'off' },
        },
        {
          reachable: { ...yes, state: 'no', since: 5, reason: 'r' },
          writes: { ...on, state: 'off', reason: 'x' },
        },
        {
          reachable: { ...yes, state: 'no', since: 5, reason: 'r' },
          writes: { ...on, state: 'off', reason: 'x', cause: 'narrowing' },
        },
        { reachable: null, writes: { ...on, state: 'off', reason: 'x', cause: 'narrowing' } },
        { reachable: null, writes: null },
      ];
      for (const [i, step] of steps.entries()) {
        socket.message(heartbeat(step));
        expect(onBackendChange).toHaveBeenCalledTimes(i + 2);
        expect(onBackendChange.mock.lastCall![0]).toMatchObject({
          reachable: step.reachable,
          writes: step.writes,
        });
      }
    });

    it.each(heartbeatVectors.sequences)(
      'vector sequence $id: onBackendChange fires on every change and every socket’s first frame',
      (sequence) => {
        const onBackendChange = vi.fn();
        const { instances } = connected(onBackendChange);
        let socketIndex = 0;
        let previous: unknown = null;
        let expectedCalls = 0;
        for (const step of sequence.steps) {
          if (step.event === 'close') {
            instances[socketIndex]!.close();
            vi.advanceTimersByTime(1000);
            socketIndex += 1;
            instances[socketIndex]!.open();
            previous = null;
            continue;
          }
          const frame = step.frame!;
          const identity = JSON.stringify([
            frame.backend,
            frame.label,
            frame.notice,
            frame.binding,
            frame.reachable ?? null,
            frame.writes ?? null,
          ]);
          if (identity !== previous) expectedCalls += 1;
          previous = identity;
          instances[socketIndex]!.message(frame);
          expect(onBackendChange).toHaveBeenCalledTimes(expectedCalls);
          expect(onBackendChange.mock.lastCall![0]).toMatchObject({
            reachable: frame.reachable ?? null,
            writes: frame.writes ?? null,
          });
        }
      }
    );

    it('a heartbeat carrying identity still counts as liveness', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        pingIntervalMs: 1000,
        pongTimeoutMs: 500,
        onBackendChange: () => {},
      });
      service.connect();
      const socket = instances[0]!;
      socket.open();
      vi.advanceTimersByTime(1000);
      socket.message(heartbeat());
      vi.advanceTimersByTime(500);
      expect(socket.readyState).toBe(1);
    });
  });

  // ── Unsubscribe ───────────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('sends nothing while other listeners remain, and unsubscribes + drops the snapshot when the last one leaves', async () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = service.subscribe('PV1', listener1);
      const unsub2 = service.subscribe('PV1', listener2);
      socket.message(initialFrame({ PV1: makeValue({ pv: 'PV1', value: 1 }) }));

      await flushSends();
      socket.sent.length = 0;
      unsub1();
      await flushSends();
      expect(socket.sent).toHaveLength(0);
      expect(service.getSnapshot('PV1')).toBeDefined();

      unsub2();
      // The snapshot goes at once; the frame follows at the end of the tick.
      expect(service.getSnapshot('PV1')).toBeUndefined();
      await flushSends();
      expect(socket.parsedSent()).toEqual([{ type: 'unsubscribe', pvNames: ['PV1'] }]);
    });
  });

  // ── Frame batching ──────────────────────────────────────────────────────

  describe('subscribe/unsubscribe batching', () => {
    function openService() {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();
      return { service, socket, instances };
    }

    it('coalesces N synchronous subscribes into one frame with N names', async () => {
      const { service, socket } = openService();
      const names = Array.from({ length: 200 }, (_, i) => `PV${i}`);
      for (const name of names) service.subscribe(name, vi.fn());

      expect(socket.sent).toHaveLength(0); // nothing until the end of the tick
      await flushSends();
      expect(socket.parsedSent()).toEqual([{ type: 'subscribe', pvNames: names }]);
    });

    it('a second listener on a pending PV adds no name, and later ticks get their own frame', async () => {
      const { service, socket } = openService();
      service.subscribe('A', vi.fn());
      service.subscribe('A', vi.fn());
      service.subscribe('B', vi.fn());
      await flushSends();
      service.subscribe('C', vi.fn());
      await flushSends();
      expect(socket.parsedSent()).toEqual([
        { type: 'subscribe', pvNames: ['A', 'B'] },
        { type: 'subscribe', pvNames: ['C'] },
      ]);
    });

    it('splits a batch larger than the per-frame cap into several frames', async () => {
      const { service, socket } = openService();
      const names = Array.from({ length: 2500 }, (_, i) => `PV${i}`);
      for (const name of names) service.subscribe(name, vi.fn());
      await flushSends();
      const frames = socket.parsedSent() as { type: string; pvNames: string[] }[];
      expect(frames.map((f) => f.pvNames.length)).toEqual([1000, 1000, 500]);
      expect(frames.every((f) => f.type === 'subscribe')).toBe(true);
      expect(frames.flatMap((f) => f.pvNames)).toEqual(names);
    });

    it('keeps mixed subscribe/unsubscribe order as consecutive runs', async () => {
      const { service, socket } = openService();
      const unsubA = service.subscribe('A', vi.fn());
      const unsubB = service.subscribe('B', vi.fn());
      await flushSends();
      socket.sent.length = 0;

      service.subscribe('C', vi.fn());
      service.subscribe('D', vi.fn());
      unsubA();
      unsubB();
      service.subscribe('E', vi.fn());
      await flushSends();

      expect(socket.parsedSent()).toEqual([
        { type: 'subscribe', pvNames: ['C', 'D'] },
        { type: 'unsubscribe', pvNames: ['A', 'B'] },
        { type: 'subscribe', pvNames: ['E'] },
      ]);
    });

    it('re-subscribing a PV unsubscribed in the same tick sends both frames in order, so the server re-seeds it', async () => {
      const { service, socket } = openService();
      const unsub = service.subscribe('A', vi.fn());
      await flushSends();
      socket.sent.length = 0;

      unsub();
      service.subscribe('A', vi.fn());
      await flushSends();

      expect(socket.parsedSent()).toEqual([
        { type: 'unsubscribe', pvNames: ['A'] },
        { type: 'subscribe', pvNames: ['A'] },
      ]);
    });

    it('a subscribe undone in the same tick sends nothing and leaves no subscription behind', async () => {
      const { service, socket, instances } = openService();
      const unsub = service.subscribe('A', vi.fn());
      service.subscribe('B', vi.fn());
      unsub();
      await flushSends();

      expect(socket.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['B'] }]);

      // A StrictMode-style mount/unmount/mount nets to one subscribe.
      socket.sent.length = 0;
      const unsubC = service.subscribe('C', vi.fn());
      unsubC();
      const listenerC = vi.fn();
      service.subscribe('C', listenerC);
      await flushSends();
      expect(socket.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['C'] }]);

      // Net frames on the wire: subscribe B, subscribe C -- exactly the PVs
      // with listeners, which is also what a reconnect resubscribes. A stray
      // frame for A is ignored rather than cached.
      socket.message(initialFrame({ A: makeValue({ pv: 'A' }) }, { A: makeMeta({ pv: 'A' }) }));
      expect(service.getSnapshot('A')).toBeUndefined();
      expect(service.getMeta('A')).toBeUndefined();

      socket.close();
      vi.advanceTimersByTime(1000);
      instances[1]!.open();
      expect(instances[1]!.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['B', 'C'] }]);
    });

    it('reconnect resubscribes every listened PV in one frame and drops ops queued for the dead socket', async () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket1 = instances[0]!;
      socket1.open();
      const unsubA = service.subscribe('A', vi.fn());
      service.subscribe('B', vi.fn());
      await flushSends();
      socket1.sent.length = 0;

      // Queued while open, but the socket dies before the tick ends.
      service.subscribe('C', vi.fn());
      unsubA();
      socket1.close();
      await flushSends();
      expect(socket1.sent).toHaveLength(0);

      vi.advanceTimersByTime(1000);
      const socket2 = instances[1]!;
      socket2.open();
      await flushSends();
      expect(socket2.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['B', 'C'] }]);
    });

    it('sends nothing while the socket is not open', async () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      const unsub = service.subscribe('A', vi.fn());
      service.subscribe('B', vi.fn());
      unsub();
      await flushSends();
      expect(socket.sent).toHaveLength(0);

      socket.open();
      await flushSends();
      expect(socket.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['B'] }]);
    });

    it('drops queued ops on disconnect()', async () => {
      const { service, socket } = openService();
      service.subscribe('A', vi.fn());
      service.disconnect();
      await flushSends();
      expect(socket.sent).toHaveLength(0);
    });
  });

  // ── put / write ───────────────────────────────────────────────────────────

  describe('put / write', () => {
    function makeFetchMock(response: { ok: boolean; status: number; text?: string }) {
      return vi.fn<FetchLike>(async () => ({
        ok: response.ok,
        status: response.status,
        text: async () => response.text ?? '',
      }));
    }

    it('put() PUTs to the derived REST base with X-API-Key and a {value} body', async () => {
      const fetchFn = makeFetchMock({ ok: true, status: 200 });
      const service = new HarePVService({
        url: BASE_URL,
        apiKey: 'secret-key',
        fetchFn,
      });

      service.put('X', 3.2);
      await vi.runAllTimersAsync();

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(url).toBe('http://host/hare/v1/pvs/X');
      expect(init.method).toBe('PUT');
      expect(init.headers['X-API-Key']).toBe('secret-key');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe('{"value":3.2}');
    });

    it('write() includes wait when explicitly set to false', async () => {
      const fetchFn = makeFetchMock({ ok: true, status: 200 });
      const service = new HarePVService({ url: BASE_URL, fetchFn });

      await service.write('X', 3.2, { wait: false });

      const [, init] = fetchFn.mock.calls[0]!;
      expect(init.body).toBe('{"value":3.2,"wait":false}');
    });

    it('write() rejects with an Error mentioning the HTTP status on a non-ok response', async () => {
      const fetchFn = makeFetchMock({ ok: false, status: 422, text: 'bad value' });
      const service = new HarePVService({ url: BASE_URL, fetchFn });

      await expect(service.write('X', 3.2)).rejects.toThrow(/422/);
    });

    it('write() surfaces the backend {code, detail} envelope as a CanopyError', async () => {
      const fetchFn = makeFetchMock({
        ok: false,
        status: 403,
        text: '{"code":"insufficient_write_access","detail":"API key does not have write access"}',
      });
      const service = new HarePVService({ url: BASE_URL, apiKey: 'ro-key', fetchFn });

      await expect(service.write('X', 3.2)).rejects.toMatchObject({
        name: 'CanopyError',
        code: 'insufficient_write_access',
        status: 403,
        detail: 'API key does not have write access',
      });
    });

    it('put() routes a failing fetch to onError instead of throwing an unhandled rejection', async () => {
      const fetchFn: FetchLike = vi.fn(async () => {
        throw new Error('network down');
      });
      const onError = vi.fn<(error: HareError) => void>();
      const service = new HarePVService({ url: BASE_URL, fetchFn, onError });

      service.put('X', 1);
      await vi.runAllTimersAsync();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0].message).toMatch(/network down/);
    });
  });

  // ── disconnect / connect lifecycle ───────────────────────────────────────

  describe('disconnect', () => {
    it('closes the socket, marks PVs disconnected, and does not schedule a reconnect', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();

      const listener = vi.fn();
      service.subscribe('PV1', listener);
      socket.message(initialFrame({ PV1: makeValue({ pv: 'PV1', value: 1 }) }));
      listener.mockClear();

      service.disconnect();

      expect(socket.readyState).toBe(3); // CLOSED
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0]).toMatchObject({
        connected: false,
        value: 0,
        displayValue: '',
        valueKind: 'scalar',
      });
      expect(service.isConnected).toBe(false);

      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(1); // no reconnect attempted

      service.connect();
      expect(instances).toHaveLength(2);

      instances[1]!.open();
      expect(instances[1]!.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['PV1'] }]);
    });
  });

  // ── Disconnected copies ───────────────────────────────────────────────────

  describe('disconnected copies', () => {
    function waveformService() {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      service.connect();
      const socket = instances[0]!;
      socket.open();
      return { service, socket, instances };
    }

    it('disconnected copy keeps the waveform kind', () => {
      const { service, socket } = waveformService();
      const listener = vi.fn();
      service.subscribe('W', listener);
      socket.message(
        initialFrame(
          { W: makeValue({ pv: 'W', value: [1, 2, 3], valueKind: 'waveform' }) },
          { W: makeMeta({ pv: 'W', valueKind: 'waveform' }) }
        )
      );
      expect(listener.mock.calls.at(-1)![0].value).toEqual([1, 2, 3]);

      socket.close();

      const data = listener.mock.calls.at(-1)![0];
      expect(data).toMatchObject({
        connected: false,
        severity: AlarmSeverity.DISCONNECTED,
        valueKind: 'waveform',
        displayValue: '',
      });
      expect(data.value).toEqual([]);
      expect(service.getMeta('W')).toBeUndefined();

      // A browser opening during an outage: no prior snapshot, the frame's
      // kind decides the empty value.
      const fresh = waveformService();
      const freshListener = vi.fn();
      fresh.service.subscribe('W2', freshListener);
      fresh.socket.message(
        initialFrame({
          W2: makeValue({ pv: 'W2', value: null, valueKind: 'waveform', connected: false }),
        })
      );
      const copy = freshListener.mock.calls.at(-1)![0];
      expect(copy).toMatchObject({ connected: false, valueKind: 'waveform', displayValue: '' });
      expect(copy.value).toEqual([]);
    });

    it('keeps the previous snapshot kind over the frame kind', () => {
      const { service, socket } = waveformService();
      const listener = vi.fn();
      service.subscribe('W', listener);
      socket.message(
        initialFrame({ W: makeValue({ pv: 'W', value: [4, 5], valueKind: 'waveform' }) })
      );
      socket.message(
        diffFrame({ W: makeValue({ pv: 'W', value: null, valueKind: 'scalar', connected: false }) })
      );
      const data = listener.mock.calls.at(-1)![0];
      expect(data.valueKind).toBe('waveform');
      expect(data.value).toEqual([]);
      expect(data.displayValue).toBe('');
    });

    it('uses an empty table and an empty string for those kinds', () => {
      const { service, socket } = waveformService();
      const tableListener = vi.fn();
      const stringListener = vi.fn();
      service.subscribe('T', tableListener);
      service.subscribe('S', stringListener);
      socket.message(
        initialFrame({
          T: makeValue({
            pv: 'T',
            value: { labels: ['a'], columns: [[1, 2]] },
            valueKind: 'table',
          }),
          S: makeValue({ pv: 'S', value: 'on', valueKind: 'string' }),
        })
      );
      socket.close();
      expect(tableListener.mock.calls.at(-1)![0].value).toEqual({ labels: [], columns: [] });
      expect(stringListener.mock.calls.at(-1)![0].value).toBe('');
    });

    it('clears metas on socket close', () => {
      const { service, socket } = waveformService();
      service.subscribe('PV1', vi.fn());
      socket.message(
        initialFrame(
          { PV1: makeValue({ pv: 'PV1', value: 1 }) },
          { PV1: makeMeta({ pv: 'PV1', units: 'mm' }) }
        )
      );
      expect(service.getMeta('PV1')?.units).toBe('mm');
      socket.close();
      expect(service.getMeta('PV1')).toBeUndefined();
    });

    it('delivers a disconnected snapshot at once to a subscribe while disconnected', () => {
      const { service, socket } = waveformService();
      socket.close();
      expect(service.status).toBe('disconnected');

      const listener = vi.fn();
      service.subscribe('LATE', listener);

      expect(listener).toHaveBeenCalledTimes(1);
      const data = listener.mock.calls[0]![0];
      expect(data).toMatchObject({
        connected: false,
        severity: AlarmSeverity.DISCONNECTED,
        value: 0,
        displayValue: '',
      });
      expect(data).not.toHaveProperty('valueKind');
      expect(service.getSnapshot('LATE')).toEqual(data);
    });

    it('delivers nothing on subscribe before the first connection', () => {
      const { factory } = createFakeWebSocketFactory();
      const service = new HarePVService({ url: BASE_URL, webSocketFactory: factory });
      const idleListener = vi.fn();
      service.subscribe('A', idleListener);
      expect(idleListener).not.toHaveBeenCalled();

      service.connect();
      const connectingListener = vi.fn();
      service.subscribe('B', connectingListener);
      expect(connectingListener).not.toHaveBeenCalled();
    });
  });

  // ── status changes ────────────────────────────────────────────────────────

  describe('status changes', () => {
    it('fires onStatusChange exactly when the status value changes', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const onStatusChange = vi.fn();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        onStatusChange,
      });

      service.connect();
      expect(onStatusChange.mock.calls).toEqual([['connecting']]);

      instances[0]!.open();
      expect(onStatusChange.mock.calls).toEqual([['connecting'], ['connected']]);

      instances[0]!.close();
      expect(onStatusChange.mock.calls).toEqual([['connecting'], ['connected'], ['disconnected']]);
    });
  });

  // ── terminal close codes ────────────────────────────────────────────────

  describe('terminal close codes', () => {
    it('stops reconnecting after a 1008 close, reports it, and marks PVs disconnected', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const onError = vi.fn<(error: HareError) => void>();
      const onStatusChange = vi.fn();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        onError,
        onStatusChange,
      });
      service.connect();
      const listener = vi.fn();
      service.subscribe('PV1', listener);
      instances[0]!.open();
      listener.mockClear();

      instances[0]!.close(1008, 'invalid_api_key: Invalid API key');

      expect(service.status).toBe('disconnected');
      expect(onStatusChange.mock.calls.at(-1)).toEqual(['disconnected']);
      expect(listener.mock.calls[0]![0].connected).toBe(false);
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'ws_terminal_close',
        message:
          'HarePVService: server closed the connection with code 1008 (invalid_api_key: Invalid API key); not reconnecting',
      });

      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(1);

      // An explicit connect() starts over and resubscribes.
      service.connect();
      instances[1]!.open();
      expect(instances[1]!.parsedSent()).toEqual([{ type: 'subscribe', pvNames: ['PV1'] }]);
    });

    it('keeps reconnecting on 1008 when terminalCloseCodes is empty, and always on 1006', () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const service = new HarePVService({
        url: BASE_URL,
        webSocketFactory: factory,
        terminalCloseCodes: [],
      });
      service.connect();
      instances[0]!.close(1008);
      vi.advanceTimersByTime(1000);
      expect(instances).toHaveLength(2);

      const defaults = createFakeWebSocketFactory();
      new HarePVService({ url: BASE_URL, webSocketFactory: defaults.factory }).connect();
      defaults.instances[0]!.close(1006);
      vi.advanceTimersByTime(1000);
      expect(defaults.instances).toHaveLength(2);
    });
  });
});
