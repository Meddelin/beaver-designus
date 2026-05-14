import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
    globals: false,
    reporters: process.env.CI ? ["default"] : ["default"],
    pool: "threads",
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "shared"),
    },
  },
});
