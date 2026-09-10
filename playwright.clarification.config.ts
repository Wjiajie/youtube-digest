import { defineConfig } from "@playwright/test";
import journal from "./playwright.journal.config";
import { localSupabaseTestConfig } from "./scripts/local-supabase-test-config.mjs";

const local = localSupabaseTestConfig();
export default defineConfig({
  ...journal,
  testDir: "./apps/web/e2e-clarification",
  outputDir: ".goal-loop/evidence/clarification-production",
  timeout: 90_000,
  globalSetup: "./scripts/planning-edge-test-setup.mjs",
  webServer: {
    ...journal.webServer,
    command: "npm run build:web && npm run start --workspace @blueprint/web -- --port 3100",
    url: "http://127.0.0.1:3100/login", reuseExistingServer: false, timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "clarification-local-test-extension",
      BLUEPRINT_PLANNING_ENABLED: "false", BLUEPRINT_CLARIFICATION_ENABLED: "true",
      DEEPSEEK_API_KEY: "clarification-fixture-key",
      BLUEPRINT_CLARIFICATION_WORKER_SECRET: "local-only-clarification-worker-fixture-secret-32",
      NODE_OPTIONS: `--import=${new URL("./scripts/clarification-provider-fixture.mjs", import.meta.url).href}`,
    },
  },
});
