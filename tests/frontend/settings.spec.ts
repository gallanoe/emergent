import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("application settings theme control updates data-theme", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await page.locator("aside").getByTitle("Application settings").click();
  await expect(page.getByText("Appearance", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "dark", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("dark");

  await page.getByRole("button", { name: "light", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("light");
});
