import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { localSupabaseTestConfig } from "./scripts/local-supabase-test-config.mjs";

const local = localSupabaseTestConfig();
const workerKey = process.env.BLUEPRINT_TRANSLATION_TEST_WORKER_SECRET ??= randomBytes(32).toString("hex");
const disabled = process.env.BLUEPRINT_TRANSLATION_ENTRY_TEST_DISABLED === "true";
export default defineConfig({
  testDir: "./apps/web/translation-e2e", workers: 1, retries: 0, timeout: 60_000,
  outputDir: ".goal-loop/evidence/translation-http", reporter: "list",
  use: { baseURL: "http://127.0.0.1:3200", trace: "off" },
  globalSetup: "./scripts/translation-edge-test-setup.mjs",
  webServer: {
    command: "npm run build:web && npm run start --workspace @blueprint/web -- --port 3200",
    url: "http://127.0.0.1:3200/login", reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "translation-local-test-extension", BLUEPRINT_TRANSLATION_ENABLED: disabled ? "false" : "true",
      BLUEPRINT_TRANSLATION_WORKER_SECRET: disabled ? "" : workerKey, DEEPSEEK_API_KEY: disabled ? "" : "translation-fixture-model-key",
      NODE_OPTIONS: `--import=${new URL("./scripts/translation-provider-fixture.mjs", import.meta.url).href}` },
  },
});
