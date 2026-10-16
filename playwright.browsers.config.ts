import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  // Native playback sessions share the OS audio output across workers.
  // Isolate scenarios; each scenario still runs its real listeners together.
  workers: 1,
  testMatch: "browser-regressions.spec.ts",
  outputDir: "test-results/browsers",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
