import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const config: NextConfig = {
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@sync/shared"],
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  turbopack: { root: fileURLToPath(new URL("../../", import.meta.url)) },
};
export default config;
