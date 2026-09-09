import { defineConfig } from "@playwright/test";
import { localSupabaseTestConfig } from "./scripts/local-supabase-test-config.mjs";

const local = localSupabaseTestConfig();
export default defineConfig({
  testDir: "./apps/web/journal-e2e", workers: 1, retries: 0, timeout: 60_000,
  outputDir: ".goal-loop/evidence/journal",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", viewport: { width: 1440, height: 1000 }, trace: "off" },
  webServer: {
    command: "npm run build:web && npm run start --workspace @blueprint/web -- --port 3100",
    url: "http://127.0.0.1:3100/login", reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "journal-local-test-extension" },
  },
});
