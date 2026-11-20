import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockPVService } from './MockPVService.js';

describe('MockPVService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers an immediate value on subscribe and periodic updates thereafter', () => {
    const service = new MockPVService();
    service.connect();

    const listener = vi.fn();
    service.subscribe('DEMO:LASER:POWER', listener);

    // Initial value delivered synchronously.
    expect(listener).toHaveBeenCalledTimes(1);
    const first = listener.mock.calls[0]![0];
    expect(typeof first.value).toBe('number');
    expect(first.connected).toBe(true);

    // Periodic updates: advance well past the max simulated update rate
    // (5000ms + jitter) so at least one more tick is guaranteed.
    vi.advanceTimersByTime(6000);
    expect(listener.mock.calls.length).toBeGreaterThan(1);
  });

  it('put() updates the value, formats displayValue, and notifies listeners', () => {
    const service = new MockPVService();
    service.connect();

    const listener = vi.fn();
    service.subscribe('TEMP:BLDG:1', listener);
    listener.mockClear();

    service.put('TEMP:BLDG:1', 42);

    expect(listener).toHaveBeenCalledTimes(1);
    const data = listener.mock.calls[0]![0];
    expect(data.value).toBe(42);
    expect(data.displayValue).toBe('42.0 C');

    const snapshot = service.getSnapshot('TEMP:BLDG:1');
    expect(snapshot?.value).toBe(42);
  });

  it('submit() writes a simulated PV and resolves confirmed', async () => {
    const service = new MockPVService();
    const listener = vi.fn();
    service.subscribe('SIM:TEMP:1', listener);
    listener.mockClear();

    await expect(service.submit('SIM:TEMP:1', 21)).resolves.toEqual({
      outcome: 'confirmed',
      row: 'confirmed',
      code: null,
      status: null,
      detail: 'written',
      coalesced: false,
    });
    expect(listener.mock.lastCall![0]).toMatchObject({ value: 21, displayValue: '21.0 C' });
    await service.submit('SIM:TEMP:1', true);
    expect(service.getSnapshot('SIM:TEMP:1')?.value).toBe(1);
    await service.submit('SIM:TEMP:1', '19.5');
    expect(service.getSnapshot('SIM:TEMP:1')?.value).toBe(19.5);
  });

  it('submit() refuses, writing nothing, a PV it does not simulate or a value that is no number', async () => {
    const service = new MockPVService();
    const refused = {
      outcome: 'refused',
      row: 'connector-refused',
      code: null,
      status: null,
      detail: 'the write was refused; nothing written',
      coalesced: false,
    };
    await expect(service.submit('SIM:PV1', 1)).resolves.toEqual(refused);
    expect(service.getSnapshot('SIM:PV1')).toBeUndefined();

    service.subscribe('SIM:PV2', vi.fn());
    const before = service.getSnapshot('SIM:PV2');
    await expect(service.submit('SIM:PV2', 'high')).resolves.toEqual(refused);
    await expect(service.submit('SIM:PV2', [1, 2])).resolves.toEqual(refused);
    expect(service.getSnapshot('SIM:PV2')).toBe(before);
  });

  it('stops the interval once the last listener for a PV unsubscribes', () => {
    const service = new MockPVService();
    service.connect();

    const listener = vi.fn();
    const unsubscribe = service.subscribe('CURRENT:1', listener);

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unsubscribe();

    expect(vi.getTimerCount()).toBe(0);

    // No more notifications after unsubscribe, however long we wait.
    listener.mockClear();
    vi.advanceTimersByTime(10000);
    expect(listener).not.toHaveBeenCalled();
  });
});
