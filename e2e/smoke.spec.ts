// e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("app renders with swarm UI", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  // Sidebar renders with app title
  await expect(page.locator("text=emergent").first()).toBeVisible();

  // Swarm group is visible
  await expect(page.locator("text=website-redesign")).toBeVisible();

  // Selected agent's chat is visible
  await expect(page.locator("text=Refactoring the navigation component")).toBeVisible();

  // Chat messages render
  await expect(page.locator("text=analyzing the current navigation structure").first()).toBeVisible();

  // Chat input is visible
  await expect(page.locator("textarea")).toBeVisible();
});
