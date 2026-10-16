import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/node",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "npm run start -w @sync/server", url: "http://127.0.0.1:4000/health", reuseExistingServer: false, env: { HOST: "127.0.0.1", PORT: "4000", CLIENT_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000" } },
    { command: "npm run start -w web", url: "http://127.0.0.1:3000", reuseExistingServer: false, env: { API_INTERNAL_URL: "http://127.0.0.1:4000" }, timeout: 60_000 },
  ],
});
