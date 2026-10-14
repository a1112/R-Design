import { unavailable } from './notice';

export const isTauri = () => false;
export type UnlistenFn = () => void;
export async function invoke<T>(command: string, _args?: Record<string, unknown>): Promise<T> {
  throw unavailable(command);
}
export async function listen<T>(_event: string, _callback: (event: { payload: T }) => void): Promise<UnlistenFn> {
  throw unavailable('native event subscription');
}
export class Channel<T> { onmessage?: (message: T) => void; }
export function getCurrentWindow() {
  return {
    minimize: async () => { throw unavailable('minimize window'); },
    maximize: async () => { throw unavailable('maximize window'); },
    toggleMaximize: async () => { throw unavailable('toggle maximize window'); },
    close: async () => { throw unavailable('close native window'); },
    hide: async () => { throw unavailable('hide native window'); },
    show: async () => { throw unavailable('show native window'); },
    startDragging: async () => { throw unavailable('drag native window'); },
  };
}
