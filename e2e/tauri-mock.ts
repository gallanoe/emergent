/**
 * Minimal Tauri API mock for Playwright E2E tests.
 * Stubs window.__TAURI_INTERNALS__ so the Svelte app
 * can boot in a plain Chromium browser.
 */
export const tauriMockScript = `
(function() {
  // Enable demo mode at runtime (replaces compile-time VITE_DEMO_MODE)
  window.__EMERGENT_DEMO_MODE__ = true;

  let callbackId = 0;
  const callbacks = {};

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      if (cmd.startsWith("plugin:event|")) return Promise.resolve(args && args.handler);
      const responses = {
        detect_agents: [],
      };
      return Promise.resolve(responses[cmd] ?? null);
    },
    transformCallback: function(cb) {
      const id = ++callbackId;
      callbacks[id] = cb;
      return id;
    },
    unregisterCallback: function(id) {
      delete callbacks[id];
    },
    callbacks: callbacks
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function(event, eventId) {}
  };
})();
`;
