import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("agent page shows system prompt and saves edits", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await page
    .locator("aside")
    .getByRole("button", { name: /claude-sonnet/i })
    .first()
    .click();

  await expect(page.getByText("System prompt", { exact: true })).toBeVisible();

  await page.getByTitle("Edit system prompt").click();
  const unique = `E2E prompt ${Date.now()}`;
  await page.locator("textarea").fill(unique);
  await page.getByTitle("Save system prompt").click();

  await expect(page.getByText(unique)).toBeVisible();

  await page.getByTitle("Workspace overview").click();
  await page
    .locator("aside")
    .getByRole("button", { name: /claude-sonnet/i })
    .first()
    .click();
  await expect(page.getByText(unique)).toBeVisible();
});
