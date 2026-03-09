import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/main.ts"],
    format: ["cjs"],
    outDir: "dist-electron",
    sourcemap: true,
    clean: true,
    noExternal: (id) => id.startsWith("@emergent/"),
    outExtensions: () => ({ js: ".js" }),
  },
  {
    entry: ["src/preload.ts"],
    format: ["cjs"],
    outDir: "dist-electron",
    sourcemap: true,
    outExtensions: () => ({ js: ".js" }),
  },
]);
