// e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("app renders with swarm UI", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  // InnerSidebar renders with swarm name
  await expect(page.locator("text=website-redesign").first()).toBeVisible();

  // Swarm view nav is visible
  await expect(page.locator("text=Swarm").first()).toBeVisible();

  // Agent cards are visible in SwarmView
  await expect(page.locator("text=Refactoring the navigatio").first()).toBeVisible();

  // Click an agent to open chat view
  await page.locator("text=Refactoring the navigati").first().click();

  // Chat messages render
  await expect(
    page.locator("text=analyzing the current navigation structure").first(),
  ).toBeVisible();

  // Chat input is visible
  await expect(page.locator("textarea")).toBeVisible();
});
