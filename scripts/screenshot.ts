import { test } from "@playwright/test";
import { setupMocks, openTestWorkspace } from "../e2e/helpers";
import * as fs from "fs";
import * as path from "path";

test("capture screenshot", async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");
  await openTestWorkspace(page);

  // Wait a beat for any transitions to settle
  await page.waitForTimeout(500);

  const dir = path.join(process.cwd(), ".screenshots");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await page.screenshot({
    path: path.join(dir, "capture.png"),
    fullPage: false,
  });

  console.log("Screenshot saved to .screenshots/capture.png");
});
