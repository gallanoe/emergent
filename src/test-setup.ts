/**
 * Vitest setup: mock Tauri internals so stores/components
 * that import @tauri-apps can be loaded in jsdom.
 */

const callbacks: Record<number, Function> = {};
let callbackId = 0;

(globalThis as any).__TAURI_INTERNALS__ = {
  invoke: (_cmd: string, _args?: unknown) => Promise.resolve(null),
  transformCallback: (cb: Function) => {
    const id = ++callbackId;
    callbacks[id] = cb;
    return id;
  },
  unregisterCallback: (id: number) => {
    delete callbacks[id];
  },
  callbacks,
};

(globalThis as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};

// Polyfill Element.animate for Svelte transitions in jsdom
if (typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = function () {
    return { finished: Promise.resolve(), cancel: () => {} } as any;
  };
}
