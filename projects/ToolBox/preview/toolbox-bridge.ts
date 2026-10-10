import { unavailable } from './notice';

const nativeEffects = new Set(['startBenchmark', 'startStressTest', 'stopTest', 'exportReport', 'reexportReport', 'openReportsDirectory']);
/** Retain the upstream synthetic read model, never return a successful native effect receipt. */
export function restrictPreviewBridge<T extends object>(bridge: T): T {
  return new Proxy(bridge, {
    get(target, property, receiver) {
      if (nativeEffects.has(String(property))) return async () => {
        const error = unavailable('ToolBox ' + String(property));
        throw { schemaVersion: 1, code: 'unsupported', message: error.message, details: 'synthetic preview only; no native action executed', retryable: false };
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
