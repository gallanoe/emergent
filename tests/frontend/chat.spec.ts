import { test, expect } from "@playwright/test";
import { setupMocks } from "./helpers";

test("chat view shows seeded assistant content in demo mode", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");

  await page.locator("aside").getByTestId("sidebar-agent-a1").click();
  await page.getByRole("button", { name: "refine quantization" }).click();

  await expect(page.getByText("analyzing the current navigation structure").first()).toBeVisible();

  await expect(page.getByRole("textbox")).toHaveAttribute(
    "placeholder",
    "Demo mode — input disabled",
  );
});
