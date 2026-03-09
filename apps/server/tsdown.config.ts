import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: (id) => id.startsWith("@emergent/"),
  external: ["bun:sqlite"],
  banner: { js: "#!/usr/bin/env node\n" },
});
