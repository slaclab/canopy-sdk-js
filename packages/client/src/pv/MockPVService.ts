import type { PVService, PVData, PVListener } from './PVService.js';
import { AlarmSeverity } from '../alarm.js';

/**
 * Mock PV service that simulates EPICS PV data for development/demo.
 * Generates realistic-looking values with alarm transitions.
 */
export class MockPVService implements PVService {
  private subscriptions = new Map<string, Set<PVListener>>();
  private snapshots = new Map<string, PVData>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private _connected = false;

  get isConnected() {
    return this._connected;
  }

  connect() {
    this._connected = true;
  }

  disconnect() {
    this._connected = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  subscribe(pvName: string, listener: PVListener): () => void {
    if (!this.subscriptions.has(pvName)) {
      this.subscriptions.set(pvName, new Set());
      this.startSimulation(pvName);
    }
    this.subscriptions.get(pvName)!.add(listener);

    // Send current value immediately
    const snapshot = this.snapshots.get(pvName);
    if (snapshot) {
      listener(snapshot);
    }

    return () => {
      const subs = this.subscriptions.get(pvName);
      if (subs) {
        subs.delete(listener);
        if (subs.size === 0) {
          this.subscriptions.delete(pvName);
          const timer = this.timers.get(pvName);
          if (timer) {
            clearInterval(timer);
            this.timers.delete(pvName);
          }
        }
      }
    };
  }

  put(pvName: string, value: number | string | boolean) {
    const current = this.snapshots.get(pvName);
    if (current) {
      const numVal = typeof value === 'number' ? value : parseFloat(String(value));
      const data: PVData = {
        ...current,
        value: numVal,
        displayValue: this.formatValue(numVal, current.precision, current.units),
        severity: this.calcSeverity(numVal, current.lowerLimit, current.upperLimit),
        timestamp: Date.now(),
      };
      this.snapshots.set(pvName, data);
      this.notify(pvName, data);
    }
  }

  getSnapshot(pvName: string): PVData | undefined {
    return this.snapshots.get(pvName);
  }

  // ── Simulation ──────────────────────────────────────────────────────────

  private startSimulation(pvName: string) {
    const config = this.getSimConfig(pvName);
    const updateRate = config.rate + Math.random() * 200; // Jitter

    // Initial value
    const initialValue = config.center + (Math.random() - 0.5) * config.range;
    this.updatePV(pvName, initialValue, config);

    // Periodic updates
    const timer = setInterval(() => {
      const current = this.snapshots.get(pvName);
      if (!current) return;

      const currentVal = typeof current.value === 'number' ? current.value : 0;
      // Random walk with mean reversion
      const drift = (config.center - currentVal) * 0.05;
      const noise = (Math.random() - 0.5) * config.noise;
      const newVal = currentVal + drift + noise;

      this.updatePV(pvName, newVal, config);
    }, updateRate);

    this.timers.set(pvName, timer);
  }

  private updatePV(pvName: string, value: number, config: SimConfig) {
    const severity = this.calcSeverity(value, config.loLo, config.hiHi);
    const data: PVData = {
      value,
      displayValue: this.formatValue(value, config.precision, config.units),
      valueKind: 'scalar',
      severity,
      connected: true,
      timestamp: Date.now(),
      units: config.units,
      precision: config.precision,
      lowerLimit: config.lo,
      upperLimit: config.hi,
    };
    this.snapshots.set(pvName, data);
    this.notify(pvName, data);
  }

  private notify(pvName: string, data: PVData) {
    const subs = this.subscriptions.get(pvName);
    if (subs) {
      for (const listener of subs) {
        listener(data);
      }
    }
  }

  private calcSeverity(value: number, lo: number, hi: number): AlarmSeverity {
    if (value > hi * 1.1 || value < lo * 0.9) return AlarmSeverity.MAJOR;
    if (value > hi || value < lo) return AlarmSeverity.MINOR;
    return AlarmSeverity.NO_ALARM;
  }

  private formatValue(value: number, precision: number, units: string): string {
    const formatted = value.toFixed(precision);
    return units ? `${formatted} ${units}` : formatted;
  }

  private getSimConfig(pvName: string): SimConfig {
    const name = pvName.toUpperCase();

    // Match PV name patterns to realistic configs
    if (name.includes('TEMP') || name.includes('THERM')) {
      return {
        center: 22.5,
        range: 10,
        noise: 0.3,
        rate: 1000,
        precision: 1,
        units: 'C',
        lo: 15,
        hi: 30,
        loLo: 10,
        hiHi: 35,
      };
    }
    if (name.includes('BDES') || name.includes('BACT')) {
      return {
        center: 5.2,
        range: 2,
        noise: 0.01,
        rate: 500,
        precision: 4,
        units: 'kG',
        lo: 3,
        hi: 7,
        loLo: 2,
        hiHi: 8,
      };
    }
    if (name.includes('CURRENT') || name.includes('CURR')) {
      return {
        center: 250,
        range: 50,
        noise: 2,
        rate: 200,
        precision: 1,
        units: 'mA',
        lo: 200,
        hi: 300,
        loLo: 150,
        hiHi: 350,
      };
    }
    if (name.includes('PRESSURE') || name.includes('PRES') || name.includes('VAC')) {
      return {
        center: 1e-7,
        range: 5e-8,
        noise: 1e-9,
        rate: 2000,
        precision: 2,
        units: 'Torr',
        lo: 1e-8,
        hi: 1e-6,
        loLo: 1e-9,
        hiHi: 1e-5,
      };
    }
    if (name.includes('STATE') || name.includes('STATUS') || name.includes('STS')) {
      return {
        center: 1,
        range: 0,
        noise: 0,
        rate: 5000,
        precision: 0,
        units: '',
        lo: 0,
        hi: 1,
        loLo: 0,
        hiHi: 1,
      };
    }
    if (name.includes('ENERGY') || name.includes('ENRGY')) {
      return {
        center: 6.0,
        range: 0.5,
        noise: 0.005,
        rate: 1000,
        precision: 3,
        units: 'GeV',
        lo: 5,
        hi: 7,
        loLo: 4,
        hiHi: 8,
      };
    }
    // Default: generic analog value
    return {
      center: 50,
      range: 40,
      noise: 1,
      rate: 500,
      precision: 2,
      units: '',
      lo: 20,
      hi: 80,
      loLo: 10,
      hiHi: 90,
    };
  }
}

interface SimConfig {
  center: number;
  range: number;
  noise: number;
  rate: number; // ms
  precision: number;
  units: string;
  lo: number;
  hi: number;
  loLo: number;
  hiHi: number;
}
