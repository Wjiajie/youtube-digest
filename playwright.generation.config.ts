import { defineConfig } from "@playwright/test";
import journal from "./playwright.journal.config";
import { localSupabaseTestConfig } from "./scripts/local-supabase-test-config.mjs";
const local = localSupabaseTestConfig();
export default defineConfig({ ...journal, testDir: "./apps/web/generation-e2e", outputDir: ".goal-loop/evidence/planning-generation",
  globalSetup: "./scripts/planning-edge-test-setup.mjs",
  webServer: { ...journal.webServer, command: "npm run build:web && npm run start --workspace @blueprint/web -- --port 3100",
    url: "http://127.0.0.1:3100/login", reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "generation-local-test-extension", BLUEPRINT_PLANNING_ENABLED: "true",
      DEEPSEEK_API_KEY: "planning-fixture-key", BLUEPRINT_PLANNING_WORKER_SECRET: "local-only-planning-worker-fixture-secret-32",
      NODE_OPTIONS: `--import=${new URL("./scripts/planning-provider-fixture.mjs", import.meta.url).href}` },
  },
});
