/**
 * Tauri API mock for Playwright E2E tests.
 * Injected via page.addInitScript() before the app loads.
 * Stubs window.__TAURI_INTERNALS__ and __TAURI_EVENT_PLUGIN_INTERNALS__
 * so the Svelte app can boot in a plain Chromium browser.
 */
export const tauriMockScript = `
(function() {
  let callbackId = 0;
  let eventId = 0;
  const callbacks = {};

  const FIXTURE_WORKSPACE = {
    id: "test-ws",
    name: "Test Workspace",
    created_at: "2026-01-01T00:00:00Z",
    last_opened: "2026-01-01T00:00:00Z"
  };

  const FIXTURE_TREE = [
    { name: "notes.md", path: "notes.md", kind: "file" },
    {
      name: "drafts",
      path: "drafts",
      kind: "folder",
      children: [
        { name: "chapter-1.md", path: "drafts/chapter-1.md", kind: "file" }
      ]
    }
  ];

  const FIXTURE_COMMIT = {
    oid: "abc1234def5678",
    message: "Initial workspace",
    time: 1735689600
  };

  function handleInvoke(cmd, args) {
    switch (cmd) {
      case "list_workspaces":
        return [FIXTURE_WORKSPACE];
      case "open_workspace":
        return FIXTURE_WORKSPACE;
      case "list_tree":
        return FIXTURE_TREE;
      case "read_document":
        return "# Hello World\\n\\nThis is a test document.";
      case "write_document":
        return null;
      case "vcs_get_status":
        return [];
      case "vcs_get_log":
        return [FIXTURE_COMMIT];
      case "plugin:event|listen":
        return ++eventId;
      case "plugin:event|unlisten":
        return null;
      default:
        return null;
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      return new Promise(function(resolve) {
        resolve(handleInvoke(cmd, args));
      });
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
    unregisterListener: function(event, eventId) {
      // no-op
    }
  };
})();
`;
