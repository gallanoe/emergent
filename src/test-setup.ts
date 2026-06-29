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

// Svelte 5 drives transition intros/outros through the Web Animations API and
// completes them via the animation's `onfinish` callback. jsdom ships a stub
// `Element.prototype.animate` whose `onfinish` never fires, so transition
// OUTROS never complete and `{#if}` blocks are never removed (intros look fine
// because their content mounts immediately). Override it unconditionally with a
// stub that finishes on the next microtask, so collapse/slide transitions settle
// deterministically in tests instead of hanging.
Element.prototype.animate = function () {
  const animation: any = {
    onfinish: null,
    oncancel: null,
    currentTime: 0,
    startTime: 0,
    playState: "finished",
    effect: null,
    finished: Promise.resolve(),
    play() {},
    pause() {},
    finish() {},
    reverse() {},
    cancel() {
      if (typeof this.oncancel === "function") this.oncancel();
    },
  };
  queueMicrotask(() => {
    if (typeof animation.onfinish === "function") animation.onfinish();
  });
  return animation;
};

// jsdom under vitest can expose a non-functional `localStorage` (no getItem);
// the theme store reads/writes it. Provide an in-memory Storage when missing.
if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
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
