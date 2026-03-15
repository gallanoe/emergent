import { chromium } from "@playwright/test";
import { tauriMockScript } from "../e2e/tauri-mock";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:1420";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 700 },
  });
  const page = await context.newPage();

  // Inject Tauri mocks before loading the app
  await page.addInitScript(tauriMockScript);
  await page.goto(BASE_URL);

  // Open the test workspace (navigate past WorkspacePicker)
  const workspaceOption = page.getByRole("option", {
    name: /Test Workspace/,
  });
  await workspaceOption.waitFor({ state: "visible", timeout: 5000 });
  await workspaceOption.dblclick();
  await page.getByTestId("activity-bar").waitFor({
    state: "visible",
    timeout: 5000,
  });

  // Wait for transitions to settle
  await page.waitForTimeout(500);

  // Save screenshot
  const dir = path.join(process.cwd(), ".screenshots");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const outPath = path.join(dir, "capture.png");
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`Screenshot saved to ${outPath}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Screenshot failed:", err);
  process.exit(1);
});
