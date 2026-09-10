import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/environment-e2e", workers: 1, fullyParallel: false, retries: 0, timeout: 90_000,
  outputDir: ".goal-loop/evidence/environment", reporter: "list",
  use: { baseURL: "http://127.0.0.1:3101", viewport: { width: 1440, height: 1100 }, trace: "off", actionTimeout: 10_000,
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
  webServer: { command: "npm run dev --workspace @blueprint/web -- --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101/design/environment", reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_environment_fixture",
      NEXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID: "environment-fixture", NEXT_PUBLIC_SENTRY_DSN: "" } },
});
