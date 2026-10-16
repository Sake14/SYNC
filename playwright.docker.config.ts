import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Run against the actual containers; do not start another application process.
export default defineConfig({
  ...base,
  workers: 2,
  // Real VPS round trips make the whole scenario longer; assertion deadlines
  // and media drift limits remain the same as the local production tests.
  timeout: 60_000,
  outputDir: process.env.SYNC_TEST_OUTPUT_DIR ?? "test-results/docker",
  webServer: undefined,
  use: { ...base.use, baseURL: process.env.SYNC_TEST_URL ?? "http://localhost:8080" },
});
