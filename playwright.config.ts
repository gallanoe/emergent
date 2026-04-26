import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/results",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://localhost:1420",
    browserName: "chromium",
    viewport: { width: 1024, height: 700 },
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testMatch: "**/*.spec.ts",
      use: {},
    },
  ],
  webServer: {
    command: "bunx vite",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    // CI cold starts: allow time for the dev server to accept connections
    timeout: 120_000,
    env: {
      VITE_DEMO_MODE: "false",
    },
  },
});
