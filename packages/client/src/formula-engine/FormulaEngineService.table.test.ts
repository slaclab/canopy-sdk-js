import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HarePVService } from '../hare/HarePVService.js';
import type { HareInitialFrame, PVMetaDTO, PVValueDTO } from '../hare/types.js';
import { DISCONNECTED_PV } from '../pv/PVService.js';
import { createFakeWebSocketFactory } from '../testing/fakeWebSocket.js';
import { FormulaEngineService } from './FormulaEngineService.js';
import type { FormulaEngineError } from './FormulaEngineService.js';
import type {
  FormulaResultDTO,
  FormulaEngineResultFrame,
  FormulaEngineSubscribeMessage,
  TableResultDTO,
} from './types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Byte-identical copies of canopy's tests/canopy/formula_engine/fixtures/table/*.json.
// canopy's test_table_contract.py pins the same sha256 constants, so a drift
// on either side fails a test on that side.

const FIXTURE_SHA256: Record<string, string> = {
  'table-result-empty.json': '218b2f06c6f86f91b6fc2fe1ad5c264ad7f5c26c488feaad7cb19d5adbcb6149',
  'table-result-trigger.json': 'db5eae12cac8c9176544b3b6f0abc838a35826dcfd729016e01268a030be6c27',
  'table-spec-max-points-absent.json':
    'ededfd70cdb9d34c2b96db79babfdbd18d35dabda2cb51c4f13736c0b0f8a26b',
  'table-spec-reject-max-points-0.json':
    '726dc8abdc71806c5e97645e5b5771534e6094dd5a6ae9efd9180e0aa214566b',
  'table-spec-reject-max-points-10001.json':
    'd80a26c31964b81fc53c5cd84acff848ff3e71d11b31b46ebebf9f3182d15977',
  'table-spec-reject-edge-on-grid.json':
    '35ec841bdff3d6d0b0c2bd058c2f5a939faf1600e919f7f3b50bb3bf2e1cdc51',
  'table-spec-timer.json': 'fc289736da0a01a13a1770c2d3ebf202a0c6d584d6430ef12068cecbd703b6cb',
  'table-spec-trigger-falling.json':
    'a8d14d97a170238ca51ffedb4ad2dba2df074d94c81d645b70e39b5b03828c35',
  'table-spec-trigger-plotted.json':
    'b3623eeca40147e1962bb5a803310463931eee48cf41371eede0cbe3a35b2dd3',
  'table-spec-trigger-rising.json':
    'e98a02139fa363b96456bef437331b55491785bc0cc72d55bb93b4f6a12a959a',
  'table-spec-trigger.json': '6139acb178013631174b975be3136db85e934de17ca8bc9540047b08dbf183fb',
  'table-spec-x-equals-y.json': 'f002685eb32970e0a2ae86ebaec08ccddea4ed77f77b9058b90309759a12ddf2',
};

// The package has no @types/node (it must stay host-agnostic), so the Node
// built-ins this test needs are reached through process.getBuiltinModule with
// just the shape used here.
interface NodeBuiltins {
  fs: { readFileSync(path: string): Uint8Array; readFileSync(path: string, enc: 'utf8'): string };
  path: { join(...parts: string[]): string; dirname(path: string): string };
  crypto: {
    createHash(algo: string): { update(data: Uint8Array): { digest(enc: 'hex'): string } };
  };
}

function builtins(): NodeBuiltins {
  const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } })
    .process;
  return {
    fs: proc.getBuiltinModule('node:fs') as NodeBuiltins['fs'],
    path: proc.getBuiltinModule('node:path') as NodeBuiltins['path'],
    crypto: proc.getBuiltinModule('node:crypto') as NodeBuiltins['crypto'],
  };
}

const node = builtins();
const FIXTURE_DIR = node.path.join(
  node.path.dirname(expect.getState().testPath ?? ''),
  '__fixtures__'
);

function fixtureBytes(name: string): Uint8Array {
  return node.fs.readFileSync(node.path.join(FIXTURE_DIR, name));
}

function fixture<T>(name: string): T {
  return JSON.parse(node.fs.readFileSync(node.path.join(FIXTURE_DIR, name), 'utf8')) as T;
}

/** Deep copy of a result frame with every input's `lateAfterFinal` removed. */
function withoutLateFlag(frame: FormulaEngineResultFrame): FormulaEngineResultFrame {
  const copy = JSON.parse(JSON.stringify(frame)) as FormulaEngineResultFrame;
  for (const input of Object.values(copy.data.table!.inputs)) {
    delete input.lateAfterFinal;
  }
  return copy;
}

function connectedService() {
  const { factory, instances } = createFakeWebSocketFactory();
  const onError = vi.fn<(error: FormulaEngineError) => void>();
  const service = new FormulaEngineService({
    baseUrl: 'https://host',
    webSocketFactory: factory,
    onError,
  });
  service.connect();
  const socket = instances[0]!;
  socket.open();
  return { service, socket, onError };
}

describe('canopy-client table protocol', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Fixture pinning ───────────────────────────────────────────────────────

  describe('fixtures', () => {
    it.each(Object.entries(FIXTURE_SHA256))('%s matches the recorded sha256', (name, digest) => {
      const actual = node.crypto.createHash('sha256').update(fixtureBytes(name)).digest('hex');
      expect(actual).toBe(digest);
    });
  });

  // ── Subscribe ─────────────────────────────────────────────────────────────

  describe('table subscribe', () => {
    it.each(Object.keys(FIXTURE_SHA256).filter((name) => name.startsWith('table-spec-')))(
      'sends %s spec unchanged, with no expression',
      (name) => {
        const message = fixture<FormulaEngineSubscribeMessage>(name);
        const { service, socket } = connectedService();

        service.subscribe(message.spec, { t0Ns: message.t0Ns, onResult: vi.fn() });

        const sent = socket.parsedSent().at(-1) as FormulaEngineSubscribeMessage;
        expect(sent.type).toBe('subscribe');
        expect(sent.spec).toEqual(message.spec);
        expect(sent.spec.kind).toBe('table');
        expect(sent.spec).not.toHaveProperty('expression');
        expect(sent.t0Ns).toBe(message.t0Ns);
      }
    );

    it('carries columns and trigger of a trigger-indexed spec', () => {
      const { spec } = fixture<FormulaEngineSubscribeMessage>('table-spec-trigger.json');
      expect(spec.index).toBe('first_input');
      expect(spec.trigger).toBe('trig');
      expect(spec.columns).toEqual({ x: '{x}', y1: '{y1}', y2: '{y2} * 1000' });
      expect(spec.maxPoints).toBe(1000);
      // Absent triggerEdge means every trigger update emits a row.
      expect(spec).not.toHaveProperty('triggerEdge');
    });

    it.each([
      ['table-spec-trigger-rising.json', 'rising'],
      ['table-spec-trigger-falling.json', 'falling'],
    ] as const)('sends the triggerEdge of %s unchanged', (name, edge) => {
      const message = fixture<FormulaEngineSubscribeMessage>(name);
      expect(message.spec.index).toBe('first_input');
      expect(message.spec.trigger).toBe('trig');
      expect(message.spec.triggerEdge).toBe(edge);
      const { service, socket } = connectedService();

      service.subscribe(message.spec, { t0Ns: message.t0Ns, onResult: vi.fn() });

      const sent = socket.parsedSent().at(-1) as FormulaEngineSubscribeMessage;
      expect(sent.spec).toEqual(message.spec);
      expect(sent.spec.triggerEdge).toBe(edge);
    });

    it('sends a triggerEdge on a grid spec as written and surfaces the server reject', () => {
      const message = fixture<FormulaEngineSubscribeMessage>('table-spec-reject-edge-on-grid.json');
      expect(message.spec.index).toBe('grid');
      expect(message.spec.triggerEdge).toBe('rising');
      const { service, socket } = connectedService();
      const onError = vi.fn<(error: FormulaEngineError) => void>();

      service.subscribe(message.spec, { t0Ns: message.t0Ns, onResult: vi.fn(), onError });

      const sent = socket.parsedSent().at(-1) as FormulaEngineSubscribeMessage;
      expect(sent.spec).toEqual(message.spec);
      socket.message({
        type: 'error',
        code: 'invalid_spec',
        message: "'triggerEdge' requires index 'first_input'",
        retryable: false,
      });
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'invalid_spec',
        message: "'triggerEdge' requires index 'first_input'",
        retryable: false,
      });
    });
  });

  // ── Results ───────────────────────────────────────────────────────────────

  describe('table result', () => {
    it('delivers the trigger fixture with history, status and lateAfterFinal intact', () => {
      const frame = fixture<FormulaEngineResultFrame>('table-result-trigger.json');
      const { service, socket } = connectedService();
      const onResult = vi.fn<(data: FormulaResultDTO) => void>();
      service.subscribe(fixture<FormulaEngineSubscribeMessage>('table-spec-trigger.json').spec, {
        onResult,
      });
      socket.message({ type: 'subscribed', id: frame.id });
      socket.message(frame);

      expect(onResult).toHaveBeenCalledTimes(1);
      const data = onResult.mock.calls[0]![0];
      expect(data.kind).toBe('table');
      const table = data.table as TableResultDTO;
      expect(table.inputs).toEqual({
        x: { history: 'seeded', status: 'ok', lateAfterFinal: false },
        y1: { history: 'not-archived', status: 'ok', lateAfterFinal: true },
        y2: { history: 'truncated', status: 'ok', lateAfterFinal: false },
        trig: { history: 'live-only', status: 'no-data', lateAfterFinal: false },
      });
      expect(table.columns).toEqual({
        x: [0.5, 0.5, 1.0],
        y1: [0.012, null, 0.025],
        y2: [-3.1, -3.0, null],
      });
      expect(table.tsNs).toHaveLength(3);
      expect(table.totalRows).toBe(3);
      // The trigger binding is an input but not a column.
      expect(Object.keys(table.columns)).not.toContain('trig');
    });

    it('delivers the empty fixture with its not-archived input', () => {
      const frame = fixture<FormulaEngineResultFrame>('table-result-empty.json');
      const { service, socket } = connectedService();
      const onResult = vi.fn<(data: FormulaResultDTO) => void>();
      service.subscribe(fixture<FormulaEngineSubscribeMessage>('table-spec-timer.json').spec, {
        onResult,
      });
      socket.message({ type: 'subscribed', id: frame.id });
      socket.message(frame);

      const table = onResult.mock.calls[0]![0].table!;
      expect(table.tsNs).toEqual([]);
      expect(table.columns).toEqual({ x: [], y: [] });
      expect(table.totalRows).toBe(0);
      expect(table.inputs.y).toEqual({
        history: 'not-archived',
        status: 'no-data',
        lateAfterFinal: false,
      });
    });

    it('reads a missing lateAfterFinal as false', () => {
      const frame = withoutLateFlag(fixture<FormulaEngineResultFrame>('table-result-trigger.json'));
      expect(frame.data.table!.inputs.y1).not.toHaveProperty('lateAfterFinal');
      const { service, socket } = connectedService();
      const onResult = vi.fn<(data: FormulaResultDTO) => void>();
      service.subscribe(fixture<FormulaEngineSubscribeMessage>('table-spec-trigger.json').spec, {
        onResult,
      });
      socket.message({ type: 'subscribed', id: frame.id });
      socket.message(frame);

      const inputs = onResult.mock.calls[0]![0].table!.inputs;
      for (const input of Object.values(inputs)) {
        expect(input.lateAfterFinal).toBe(false);
      }
      // History and status are untouched by the default.
      expect(inputs.y1).toEqual({ history: 'not-archived', status: 'ok', lateAfterFinal: false });
    });

    it('passes non-table results through unchanged', () => {
      const { service, socket } = connectedService();
      const onResult = vi.fn<(data: FormulaResultDTO) => void>();
      service.subscribe({ kind: 'scalar', expression: 'A', bindings: { A: 'PV:A' } }, { onResult });
      socket.message({ type: 'subscribed', id: 'srv-1' });
      const data: FormulaResultDTO = {
        kind: 'scalar',
        scalar: { tsNs: 1, value: 2, severity: 'NO_ALARM', inputsUsed: { A: 1 } },
        timeseries: null,
        waveform: null,
      };
      socket.message({ type: 'result', id: 'srv-1', data });
      expect(onResult).toHaveBeenCalledExactlyOnceWith(data);
    });
  });

  // ── Errors ────────────────────────────────────────────────────────────────

  describe('retryable', () => {
    it('surfaces retryable: true on a subscription error, and the subscription stays live', () => {
      const { service, socket } = connectedService();
      const onError = vi.fn<(error: FormulaEngineError) => void>();
      const onResult = vi.fn();
      service.subscribe(fixture<FormulaEngineSubscribeMessage>('table-spec-trigger.json').spec, {
        onResult,
        onError,
      });
      socket.message({ type: 'subscribed', id: 'srv-t' });
      socket.message({
        type: 'error',
        id: 'srv-t',
        code: 'archiver_timeout',
        message: 'archiver timed out',
        retryable: true,
      });
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'archiver_timeout',
        message: 'archiver timed out',
        retryable: true,
      });

      const frame = fixture<FormulaEngineResultFrame>('table-result-trigger.json');
      socket.message({ ...frame, id: 'srv-t' });
      expect(onResult).toHaveBeenCalledTimes(1);
    });

    it('surfaces retryable: false on an id-less table reject', () => {
      const { service, socket } = connectedService();
      const onError = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(
        fixture<FormulaEngineSubscribeMessage>('table-spec-reject-max-points-0.json').spec,
        {
          onResult: vi.fn(),
          onError,
        }
      );
      socket.message({
        type: 'error',
        code: 'invalid_spec',
        message: 'maxPoints must be 1-10000',
        retryable: false,
      });
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'invalid_spec',
        message: 'maxPoints must be 1-10000',
        retryable: false,
      });
    });

    it('reads a missing retryable as false', () => {
      const { service, socket } = connectedService();
      const onError = vi.fn<(error: FormulaEngineError) => void>();
      service.subscribe(fixture<FormulaEngineSubscribeMessage>('table-spec-trigger.json').spec, {
        onResult: vi.fn(),
        onError,
      });
      socket.message({ type: 'subscribed', id: 'srv-t' });
      socket.message({ type: 'error', id: 'srv-t', code: 'table_live_only', message: 'live only' });
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'table_live_only',
        message: 'live only',
        retryable: false,
      });
    });

    it('marks a connection-level error that matches no subscription with its flag', () => {
      const { socket, onError } = connectedService();
      socket.message({
        type: 'error',
        code: 'invalid_message',
        message: 'bad',
        retryable: false,
      });
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'invalid_message',
        message: 'bad',
        retryable: false,
      });
    });
  });
});

// ── Hare: valueKind and the late-connect re-describe ────────────────────────

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

function connectedHare() {
  const { factory, instances } = createFakeWebSocketFactory();
  const service = new HarePVService({ url: 'ws://host/hare/v1/ws/pvs', webSocketFactory: factory });
  service.connect();
  const socket = instances[0]!;
  socket.open();
  return { service, socket, instances };
}

describe('Hare PVData.valueKind', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('carries a diff value kind into PVData', () => {
    const { service, socket } = connectedHare();
    const listener = vi.fn();
    service.subscribe('W', listener);
    socket.message(
      initialFrame({ W: makeValue({ pv: 'W', value: 1 }) }, { W: makeMeta({ pv: 'W' }) })
    );
    expect(service.getSnapshot('W')?.valueKind).toBe('scalar');

    socket.message({
      type: 'diff',
      data: { W: makeValue({ pv: 'W', value: [1, 2, 3], valueKind: 'waveform' }) },
      count: 1,
      timestamp: 0,
    });
    expect(service.getSnapshot('W')?.valueKind).toBe('waveform');
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ valueKind: 'waveform' }));
  });

  it('keeps no kind on DISCONNECTED_PV or a disconnected copy with no prior value', () => {
    expect(DISCONNECTED_PV).not.toHaveProperty('valueKind');
    const { service, socket } = connectedHare();
    service.subscribe('Q', vi.fn());
    socket.close();
    const snap = service.getSnapshot('Q');
    expect(snap?.connected).toBe(false);
    expect(snap?.valueKind).toBeUndefined();
    expect(snap).not.toHaveProperty('valueKind');
    expect(snap?.value).toBe(0);
    expect(snap?.displayValue).toBe('');
  });

  it('keeps the prior kind on a disconnected copy', () => {
    const { service, socket } = connectedHare();
    service.subscribe('S', vi.fn());
    socket.message(initialFrame({ S: makeValue({ pv: 'S', value: 'on', valueKind: 'string' }) }));
    socket.close();
    const snap = service.getSnapshot('S');
    expect(snap?.connected).toBe(false);
    expect(snap?.valueKind).toBe('string');
    expect(snap?.value).toBe('');
    expect(snap?.displayValue).toBe('');
  });

  it('updates getMeta() from an initial that arrives after the PV first one', () => {
    const { service, socket } = connectedHare();
    service.subscribe('L', vi.fn());

    // Described before it connected: the first initial has an empty meta.
    socket.message(
      initialFrame(
        { L: makeValue({ pv: 'L', connected: false }) },
        { L: makeMeta({ pv: 'L', units: null, precision: null }) }
      )
    );
    expect(service.getMeta('L')?.units).toBeNull();

    // The broker re-describes it on its first sample and re-sends an initial.
    socket.message(
      initialFrame(
        { L: makeValue({ pv: 'L', value: 1.5, tsNs: 2_000_000 }) },
        { L: makeMeta({ pv: 'L', units: 'mm', precision: 3 }) }
      )
    );
    expect(service.getMeta('L')?.units).toBe('mm');
    expect(service.getMeta('L')?.precision).toBe(3);
    const snap = service.getSnapshot('L');
    expect(snap?.connected).toBe(true);
    expect(snap?.units).toBe('mm');
    expect(snap?.precision).toBe(3);
    expect(snap?.valueKind).toBe('scalar');
  });
});
