import type { Page } from "@playwright/test";
import { tauriMockScript } from "./tauri-mock";

/**
 * Inject Tauri mocks before the app loads.
 * Must be called before page.goto().
 */
export async function setupMocks(page: Page) {
  await page.addInitScript(tauriMockScript);
}
