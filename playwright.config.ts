import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/results",
  use: {
    baseURL: "http://localhost:1420",
    browserName: "chromium",
    viewport: { width: 1024, height: 700 },
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "demo",
      testMatch: "smoke.spec.ts",
      use: {},
    },
    {
      name: "daemon",
      testMatch: "daemon-connection.spec.ts",
      use: {},
    },
  ],
  webServer: {
    command: "bunx vite",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 10000,
  },
});
