import { describe, expect, it } from "vitest";
import { page } from "@vitest/browser/context";

describe("heading", () => {
  it("renders Overstory heading", async () => {
    // Navigate to the app root
    await page.goto("/");
    const heading = page.getByText("Overstory");
    await expect.element(heading).toBeVisible();
  });
});
