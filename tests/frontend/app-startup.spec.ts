// tests/frontend/app-startup.spec.ts
import { test, expect } from "@playwright/test";

/**
 * Tauri mock that simulates the app with no swarms or agents.
 * Provides known agent definitions but none are running.
 */
const emptyStateMock = `
(function() {
  // Real app uses: import.meta.env.VITE_DEMO_MODE === "true" || __EMERGENT_DEMO_MODE__ === true
  window.__EMERGENT_DEMO_MODE__ = false;
  let callbackId = 0;
  const callbacks = {};

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      // Handle Tauri event plugin commands (listen, unlisten, emit)
      if (cmd.startsWith("plugin:event|")) return Promise.resolve(args && args.handler);

      const responses = {
        detect_agents: [],
        detect_docker: { docker_available: true, docker_version: "27.0.0" },
        known_agents: [
          { name: "Claude Code", command: "claude-agent-acp", available: false, provider: "claude" },
          { name: "Codex", command: "codex-acp", available: false, provider: "codex" },
          { name: "Gemini", command: "gemini --experimental-acp", available: false, provider: "gemini" },
          { name: "Kiro", command: "kiro-cli acp", available: false, provider: "kiro" },
          { name: "OpenCode", command: "opencode acp", available: false, provider: "opencode" },
        ],
        list_workspaces: [],
      };
      if (cmd in responses) return Promise.resolve(responses[cmd]);
      // Never reject: unknown invocations would fail init and can surface
      // an error view instead of the empty-workspace CTA.
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

    await expect(page.getByTestId("frontend-create-workspace")).toBeVisible();
  });
});
