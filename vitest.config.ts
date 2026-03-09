import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@emergent/contracts": path.resolve(
        __dirname,
        "./packages/contracts/src/index.ts",
      ),
    },
  },
});
