import type { Page } from "@playwright/test";
import { tauriMockScript } from "./tauri-mock";

/**
 * Inject Tauri mocks and navigate to the app.
 * Must be called before page.goto().
 */
export async function setupMocks(page: Page) {
  await page.addInitScript(tauriMockScript);
}

/**
 * Navigate past WorkspacePicker into AppShell.
 * Assumes mocks are already injected and page.goto("/") has been called.
 * Clicks the first workspace in the picker list, then waits for AppShell to mount.
 */
export async function openTestWorkspace(page: Page) {
  // Wait for the workspace list to render (mock returns one workspace)
  // Use regex because accessible name includes the relative time text (e.g. "Test Workspace 14mo ago")
  const workspaceOption = page.getByRole("option", {
    name: /Test Workspace/,
  });
  await workspaceOption.waitFor({ state: "visible", timeout: 5000 });

  // Double-click to open (WorkspacePicker opens on dblclick)
  await workspaceOption.dblclick();

  // Wait for AppShell to mount
  await page.getByTestId("activity-bar").waitFor({
    state: "visible",
    timeout: 5000,
  });
}
