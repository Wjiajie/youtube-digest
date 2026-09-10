import { defineConfig } from "@playwright/test";
import journal from "./playwright.journal.config";
import { localSupabaseTestConfig } from "./scripts/local-supabase-test-config.mjs";
const local = localSupabaseTestConfig();
export default defineConfig({ ...journal, testDir: "./apps/web/resource-e2e",
  outputDir: process.env.BLUEPRINT_RESOURCE_ENTRY_TEST_DISABLED === "true" ? ".goal-loop/evidence/resource-entry-disabled" : ".goal-loop/evidence/resource-entry",
  globalSetup: "./scripts/resource-edge-test-setup.mjs",
  webServer: { ...journal.webServer, command: "npm run build:web && npm run start --workspace @blueprint/web -- --port 3100",
    url: "http://127.0.0.1:3100/login", reuseExistingServer: false, timeout: 120000,
    env: { NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "resource-local-test-extension", BLUEPRINT_RESOURCES_ENABLED: process.env.BLUEPRINT_RESOURCE_ENTRY_TEST_DISABLED === "true" ? "false" : "true",
      BLUEPRINT_RESOURCE_ADOPTION_ENABLED: process.env.BLUEPRINT_RESOURCE_ENTRY_TEST_DISABLED === "true" ? "false" : "true",
      DEEPSEEK_API_KEY: "resource-fixture-model-key", YOUTUBE_API_KEY: "resource-fixture-youtube-key", SUPADATA_API_KEY: "resource-fixture-native-key",
      BLUEPRINT_RESOURCE_WORKER_SECRET: "local-only-resource-worker-fixture-secret-32",
      NODE_OPTIONS: `--import=${new URL("./scripts/resource-provider-fixture.mjs", import.meta.url).href}` },
  },
});
