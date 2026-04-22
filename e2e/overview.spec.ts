import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("overview shows stat tiles and live session rows", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await expect(page.locator("h1", { hasText: "emergent-core" })).toBeVisible();
  await expect(page.getByText("Active agents", { exact: true })).toBeVisible();
  await expect(page.getByText("Tokens · 24h", { exact: true })).toBeVisible();

  await expect(page.getByText("Live sessions", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /refine quantization/i })).toBeVisible();
});
