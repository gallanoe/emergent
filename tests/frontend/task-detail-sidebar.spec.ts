import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

/**
 * Demo mode has no backend to populate appState's `tasks` record, so it is
 * projected from the mock data. Without that projection the task table renders
 * from `workspaceTasks` while every by-id lookup returns undefined — the detail
 * sidebar comes up blank inside a reserved 320px column, and the chat banner
 * never appears.
 */
test("task detail sidebar resolves the task, its parent, and its blockers", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await page
    .locator("aside")
    .getByRole("button", { name: /^Tasks/ })
    .click();
  await expect(page.locator("main").getByRole("heading", { name: "Tasks" })).toBeVisible();

  // TSK-040 has no session, so selecting it opens the sidebar rather than
  // navigating to a chat thread.
  await page.getByRole("button", { name: /Task TSK-040:/ }).click();

  const sidebar = page.getByTestId("task-detail-sidebar");
  await expect(sidebar).toBeVisible();

  await expect(sidebar.getByText("Document the quantization tradeoff in README")).toBeVisible();
  await expect(sidebar.getByText(/Drop CHROMA_WEIGHT/)).toBeVisible();
  await expect(sidebar.getByText(/Verify palette delta/)).toBeVisible();
});

test("chat task banner resolves the thread's task", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await page.getByText("claude-sonnet", { exact: true }).first().click();
  await page.getByText("session TSK-041").first().click();

  await expect(page.getByText(/Drop CHROMA_WEIGHT to 1\.2/).first()).toBeVisible();
});
