import { defineConfig, devices } from "@playwright/test";

/* Targets a developer who already has `npm run dev` running. We DON'T spawn
 * the dev server from the test runner — the daemon owns persistent SQLite
 * state and we don't want fixture data competing with the user's projects.
 * If the dev stack isn't up, the tests fail fast with a connection error. */

const WEB_URL = process.env.WEB_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // single daemon = serial
  retries: 0,
  reporter: process.env.CI ? "list" : "list",
  use: {
    baseURL: WEB_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
