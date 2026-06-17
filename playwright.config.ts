import { defineConfig, devices } from "@playwright/test";

// End-to-end + accessibility tests run against the app in MOCK mode (no API
// key, recorded readings), so they are deterministic, free, and need no
// secrets, in CI or locally. The webServer forces mock via an empty key var,
// so a local .dev.vars with a real key cannot turn these into paid calls.
const PORT = 8788;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: "npm run dev:mock",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
