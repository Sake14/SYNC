import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/.next/**", "**/dist/**", "**/next-env.d.ts", "playwright-report/**", "test-results/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ["apps/web/**/*.{ts,tsx}"], extends: [...nextVitals, ...nextTs], settings: { next: { rootDir: "apps/web/" } } },
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
]);
