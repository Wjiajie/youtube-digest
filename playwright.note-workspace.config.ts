import { defineConfig } from "@playwright/test";
import { localSupabaseTestConfig } from "./scripts/local-supabase-test-config.mjs";
const local = localSupabaseTestConfig();
export default defineConfig({
  testDir: "./apps/web/note-workspace-e2e", workers: 1, retries: 0, timeout: 60_000, reporter: "list",
  outputDir: ".goal-loop/evidence/note-workspace", use: { baseURL: "http://127.0.0.1:3194", viewport: { width: 1440, height: 1000 }, trace: "off" },
  webServer: { command: "npm run build:web && npm run start --workspace @blueprint/web -- --port 3194",
    url: "http://127.0.0.1:3194/login", reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "notes-workspace-local", BLUEPRINT_PLANNING_ENABLED: "false", BLUEPRINT_RESOURCES_ENABLED: "false",
      BLUEPRINT_RESOURCE_ADOPTION_ENABLED: "false", BLUEPRINT_CLARIFICATION_ENABLED: "false" } },
});
