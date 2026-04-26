/**
 * E2E test: task:status-notification queue panel rendering.
 *
 * Strategy:
 *   - Boot in non-demo mode with a single workspace + one thread.
 *   - Navigate to that thread's chat view.
 *   - Put the thread in "working" state so the queue panel shows.
 *   - Fire a synthetic task:status-notification Tauri event by invoking
 *     the registered callback stored in __TAURI_INTERNALS__.callbacks.
 *   - Assert the notification row appears and has no Edit/Remove buttons.
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock script — must be injected before page.goto().
// Captures listener callback IDs by event name so we can fire synthetic events.
// ---------------------------------------------------------------------------
const mockScript = `
(function() {
  window.__EMERGENT_DEMO_MODE__ = false;

  let callbackId = 0;
  const callbacks = {};

  // Maps Tauri event name -> callback id for synthetic event firing.
  window.__TAURI_EVENT_LISTENERS__ = {};

  window.__TAURI_INTERNALS__ = {
    invoke: function(cmd, args) {
      if (cmd === "plugin:event|listen") {
        const handlerId = args && args.handler;
        const eventName = args && args.event;
        if (eventName && handlerId != null) {
          window.__TAURI_EVENT_LISTENERS__[eventName] = handlerId;
        }
        return Promise.resolve(handlerId);
      }
      if (cmd.startsWith("plugin:event|")) return Promise.resolve(null);

      if (cmd === "list_agent_definitions") {
        return Promise.resolve([
          {
            id: "agent-e2e-1",
            workspace_id: "ws-e2e-1",
            name: "E2E Agent",
            cli: "claude",
            provider: "claude",
          },
        ]);
      }
      if (cmd === "list_thread_mappings") {
        return Promise.resolve([
          {
            thread_id: "thread-e2e-1",
            agent_definition_id: "agent-e2e-1",
            acp_session_id: "sess-e2e-1",
            task_id: null,
          },
        ]);
      }
      if (cmd === "list_threads") {
        return Promise.resolve([
          {
            id: "thread-e2e-1",
            agent_id: "agent-e2e-1",
            status: "working",
            workspace_id: "ws-e2e-1",
            acp_session_id: "sess-e2e-1",
          },
        ]);
      }
      if (cmd === "known_agents") {
        return Promise.resolve([]);
      }

      const responses = {
        get_daemon_status: "connected",
        detect_agents: [],
        detect_docker: { docker_available: true, docker_version: "27.0.0" },
        get_container_runtime_preference: { selected_runtime: "docker" },
        get_container_runtime_status: {
          selected_runtime: "docker",
          available: true,
          version: "27.0.0",
          message: null,
        },
        list_workspaces: [
          {
            id: "ws-e2e-1",
            name: "e2e-workspace",
            container_status: { state: "running" },
            agent_count: 1,
          },
        ],
        list_tasks: [],
        get_history: [],
        get_thread_config: [],
      };
      if (cmd in responses) return Promise.resolve(responses[cmd]);
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
    callbacks: callbacks,
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function(event, eventId) {}
  };

  /**
   * Fire a synthetic Tauri event by name with the given payload.
   * Must be called after the app has called listen() for the event.
   */
  window.__fireTauriEvent__ = function(eventName, payload) {
    const handlerId = window.__TAURI_EVENT_LISTENERS__[eventName];
    if (handlerId == null) {
      console.warn('[test] no listener registered for', eventName, '(registered:', Object.keys(window.__TAURI_EVENT_LISTENERS__), ')');
      return false;
    }
    const cb = callbacks[handlerId];
    if (!cb) {
      console.warn('[test] callback not found for handler id', handlerId);
      return false;
    }
    cb({ event: eventName, payload, id: 0, windowLabel: 'main' });
    return true;
  };
})();
`;

async function fireTauriEvent(page: Page, eventName: string, payload: unknown): Promise<boolean> {
  return page.evaluate(
    ({ name, data }) =>
      (
        window as unknown as { __fireTauriEvent__: (n: string, p: unknown) => boolean }
      ).__fireTauriEvent__(name, data),
    { name: eventName, data: payload },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("task:status-notification queue panel", () => {
  test("notification row appears and has no Edit or Remove buttons", async ({ page }) => {
    await page.addInitScript(mockScript);
    await page.goto("/");

    // Wait for the sidebar agent entry to appear.
    await expect(page.getByText("E2E Agent").first()).toBeVisible({ timeout: 10_000 });

    // Click the agent to open the agent view (shows the threads list).
    await page.getByText("E2E Agent").first().click();

    // Click "Thread 1" to open the chat view for that thread.
    await expect(page.getByText("Thread 1").first()).toBeVisible({ timeout: 5_000 });
    await page.getByText("Thread 1").first().click();

    // Give the store time to register the task:status-notification listener.
    await page.waitForTimeout(500);

    // Fire the synthetic event. The thread is "working" so the notification
    // lands in pendingQueue. The queue panel renders when pendingQueue is non-empty.
    const fired = await fireTauriEvent(page, "task:status-notification", {
      task_id: "task-001",
      creator_thread_id: "thread-e2e-1",
      kind: "update",
      message: "halfway through analysis",
    });

    // Confirm the event was dispatched (listener was registered).
    expect(fired).toBe(true);

    // The queue panel row should contain the notification text.
    await expect(
      page.getByText("[Task task-001] update: halfway through analysis").first(),
    ).toBeVisible({ timeout: 5_000 });

    // The task-notification row must NOT contain Edit or Remove action buttons.
    const notificationRow = page
      .getByText("[Task task-001] update: halfway through analysis")
      .locator("..")
      .locator("..");

    await expect(notificationRow.getByTitle("Edit — pull back into composer")).not.toBeVisible();

    await expect(notificationRow.getByTitle("Remove from queue")).not.toBeVisible();
  });

  test("notification row shows 'task' badge instead of numeric index", async ({ page }) => {
    await page.addInitScript(mockScript);
    await page.goto("/");

    await expect(page.getByText("E2E Agent").first()).toBeVisible({ timeout: 10_000 });
    await page.getByText("E2E Agent").first().click();
    await expect(page.getByText("Thread 1").first()).toBeVisible({ timeout: 5_000 });
    await page.getByText("Thread 1").first().click();
    await page.waitForTimeout(500);

    await fireTauriEvent(page, "task:status-notification", {
      task_id: "task-002",
      creator_thread_id: "thread-e2e-1",
      kind: "completed",
      message: "task finished",
    });

    // The 'task' badge should appear (not a numeric index like "01").
    await expect(page.getByText("task", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });
});
