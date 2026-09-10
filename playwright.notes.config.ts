import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/notes-http-e2e", workers: 1, retries: 0, timeout: 30_000, reporter: "list",
  globalSetup: "./scripts/learning-note-http-fixture.mjs",
  outputDir: ".goal-loop/evidence/learning-note-http",
  webServer: { command: "npm run build:web && npm run start --workspace @blueprint/web -- --port 3193",
    url: "http://127.0.0.1:3193/login", reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3192", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "notes-http-fixture", BLUEPRINT_RESOURCES_ENABLED: "false",
      BLUEPRINT_RESOURCE_ADOPTION_ENABLED: "false", BLUEPRINT_PLANNING_ENABLED: "false", BLUEPRINT_CLARIFICATION_ENABLED: "false" },
  },
});
