/**
 * Minimal Tauri API mock for Playwright E2E tests.
 * Stubs window.__TAURI_INTERNALS__ so the Svelte app
 * can boot in a plain Chromium browser.
 */
export const tauriMockScript = `
(function() {
  let callbackId = 0;
  const callbacks = {};

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      return Promise.resolve(null);
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
