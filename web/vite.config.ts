import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
      "@preview": resolve(__dirname, "../packages/preview-runtime/src"),
      "@manifest-data": resolve(__dirname, "../manifest-data"),
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    fs: {
      // Allow imports from the project root (libraries/, packages/,
      // manifest-data/, shared/, all live above web/).
      allow: [resolve(__dirname, "..")],
    },
    proxy: {
      "/api": "http://127.0.0.1:7457",
    },
  },
});
