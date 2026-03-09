import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: [
        "**/node_modules/**",
        "__tests__/browser/**",
      ],
    },
  }),
);
