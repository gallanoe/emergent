import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["tests/frontend/**", "scripts/**", "node_modules/**", ".claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage/frontend",
      include: ["src/**/*.{ts,svelte}"],
      exclude: [
        "src/**/*.test.ts",
        "src/test-setup.ts",
        "src/main.ts",
        "src/stores/mock-data.svelte.ts",
        // Root layout composition — wiring, not behavior. Covering it means
        // mounting the whole app with every store and IPC boundary mocked, for
        // assertions that restate the markup. The behavior it composes is
        // covered in the individual stores and components instead.
        "src/App.svelte",
      ],
      // Ratchet, set a couple of points under the measured baseline so normal
      // churn doesn't trip the build. Raise these as coverage improves — they
      // are a floor against regression, not a target.
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 90,
      },
    },
  },
});
