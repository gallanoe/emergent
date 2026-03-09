import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
    tailwindcss(),
  ],
  server: {
    port: 5733,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
