import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("app renders", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("emergent");
});
