// e2e/app-startup.spec.ts
import { test, expect } from "@playwright/test";

/**
 * Tauri mock that simulates the app with no swarms or agents.
 * Provides known agent definitions but none are running.
 */
const emptyStateMock = `
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
        detect_docker: { docker_available: true, docker_version: "27.0.0" },
        known_agents: [
          { name: "Claude Code", command: "claude-agent-acp", available: false },
          { name: "Codex", command: "codex-acp", available: false },
          { name: "Gemini", command: "gemini --experimental-acp", available: false },
          { name: "Kiro", command: "kiro-cli acp", available: false },
          { name: "OpenCode", command: "opencode acp", available: false },
        ],
        list_workspaces: [],
        get_container_runtime_preference: { selected_runtime: "docker" },
        get_container_runtime_status: {
          selected_runtime: "docker",
          available: true,
          version: "27.0.0",
          message: null,
        },
      };
      if (cmd in responses) return Promise.resolve(responses[cmd]);
      // Never reject: unknown invocations would fail init and can surface
      // the runtime-unavailable view instead of the empty-workspace CTA.
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

test.describe("app startup", () => {
  test("starts immediately without splash screen", async ({ page }) => {
    await page.addInitScript(emptyStateMock);
    await page.goto("/");

    // App renders directly with no loading state
    await expect(page.locator("text=Starting…")).not.toBeVisible();

    await expect(page.getByRole("button", { name: "Create Workspace" })).toBeVisible();
  });
});
