// e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("demo shell shows overview then agent chat", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await expect(page.locator("h1", { hasText: "emergent-core" })).toBeVisible();
  await expect(page.getByText("overview", { exact: true }).first()).toBeVisible();

  await expect(page.locator("aside").getByText("AGENTS", { exact: true })).toBeVisible();

  await page.locator("aside").getByTestId("sidebar-agent-a1").click();

  await page.getByRole("button", { name: "refine quantization" }).click();

  await expect(page.getByText("analyzing the current navigation structure").first()).toBeVisible();

  await expect(page.locator("textarea")).toBeVisible();
});
