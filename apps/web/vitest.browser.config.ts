import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["__tests__/browser/**/*.test.{ts,tsx}"],
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: "chromium", launch: { headless: true } }],
      },
    },
  }),
);
