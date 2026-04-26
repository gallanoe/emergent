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

// jsdom often omits matchMedia; theme store listens for prefers-color-scheme.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  const registry = new Map<
    string,
    { matches: boolean; listeners: Set<(e: MediaQueryListEvent) => void> }
  >();

  window.matchMedia = ((query: string): MediaQueryList => {
    if (!registry.has(query)) {
      registry.set(query, { matches: true, listeners: new Set() });
    }
    const entry = registry.get(query)!;

    return {
      get matches() {
        return entry.matches;
      },
      media: query,
      addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
        if (_type === "change") entry.listeners.add(cb);
      },
      removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
        entry.listeners.delete(cb);
      },
      addListener: (cb: (e: MediaQueryListEvent) => void) => {
        entry.listeners.add(cb);
      },
      removeListener: (cb: (e: MediaQueryListEvent) => void) => {
        entry.listeners.delete(cb);
      },
      onchange: null,
      dispatchEvent: (event: Event): boolean => {
        if (event.type !== "change") return true;
        const mq = event as MediaQueryListEvent;
        if (typeof mq.matches === "boolean") {
          entry.matches = mq.matches;
        }
        for (const fn of Array.from(entry.listeners)) {
          fn(mq);
        }
        return true;
      },
    } as MediaQueryList;
  }) as typeof window.matchMedia;
}
