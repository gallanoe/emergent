import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("task filters and navigating a session-backed task opens chat", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await page
    .locator("aside")
    .getByRole("button", { name: /^Tasks/ })
    .click();
  await expect(page.locator("main").getByRole("heading", { name: "Tasks" })).toBeVisible();

  await page.getByRole("button", { name: /^completed/ }).click();
  await expect(page.getByText(/\d+ shown · \d+ total/)).toBeVisible();

  await page.getByRole("button", { name: /^all/ }).click();
  await page.getByRole("button", { name: /Task TSK-041:/ }).click();

  await expect(page.locator("textarea")).toBeVisible();
});

test("new task is disabled when workspace container is stopped", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await page.getByTitle("Workspaces").click();
  await page.getByRole("button", { name: "api-migration" }).click();
  await page
    .locator("aside")
    .getByRole("button", { name: /^Tasks/ })
    .click();

  await expect(page.getByRole("button", { name: "New task" })).toBeDisabled();
});
