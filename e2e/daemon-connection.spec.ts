// e2e/daemon-connection.spec.ts
import { test, expect } from "@playwright/test";

/**
 * Tauri mock that simulates a disconnected daemon.
 * get_daemon_status returns "disconnected", all other commands fail.
 */
const disconnectedMock = `
(function() {
  let callbackId = 0;
  const callbacks = {};

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      if (cmd === "get_daemon_status") return Promise.resolve("disconnected");
      if (cmd.startsWith("plugin:event|")) return Promise.resolve(args && args.handler);
      return Promise.reject("Daemon not connected");
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

/**
 * Tauri mock that simulates a connected daemon with no agents.
 * get_daemon_status returns "connected", detect_agents and known_agents
 * return results, list_agents returns empty.
 */
const connectedMock = `
(function() {
  let callbackId = 0;
  const callbacks = {};

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      // Handle Tauri event plugin commands (listen, unlisten, emit)
      if (cmd.startsWith("plugin:event|")) return Promise.resolve(args && args.handler);

      const responses = {
        get_daemon_status: "connected",
        detect_agents: [],
        known_agents: [
          { name: "Claude Code", command: "claude-agent-acp", available: false },
          { name: "Codex", command: "codex-acp", available: false },
          { name: "Gemini", command: "gemini --experimental-acp", available: false },
        ],
        list_agents: [],
      };
      if (cmd in responses) return Promise.resolve(responses[cmd]);
      return Promise.reject("Unknown command: " + cmd);
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

test.describe("daemon connection states", () => {
  test("shows disconnected state when daemon is not running", async ({ page }) => {
    await page.addInitScript(disconnectedMock);
    await page.goto("/");

    // Sidebar shows "Daemon offline" status
    await expect(page.locator("text=Daemon offline")).toBeVisible();

    // Main area shows disconnected banner
    await expect(page.locator("text=Daemon not running")).toBeVisible();
    await expect(page.locator("text=emergentd")).toBeVisible();

    // New swarm button should be disabled
    const newSwarmBtn = page.locator("button", { hasText: "New swarm" });
    await expect(newSwarmBtn).toBeVisible();
    await expect(newSwarmBtn).toBeDisabled();
  });

  test("shows connected state when daemon is running", async ({ page }) => {
    await page.addInitScript(connectedMock);
    await page.goto("/");

    // Sidebar shows "Daemon connected" status
    await expect(page.locator("text=Daemon connected")).toBeVisible();

    // New swarm button should be enabled
    const newSwarmBtn = page.locator("button", { hasText: "New swarm" });
    await expect(newSwarmBtn).toBeVisible();
    await expect(newSwarmBtn).toBeEnabled();

    // No disconnected banner
    await expect(page.locator("text=Daemon not running")).not.toBeVisible();
  });
});
