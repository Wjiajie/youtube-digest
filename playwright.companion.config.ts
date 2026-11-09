import { defineConfig } from "@playwright/test";

// Run against the already-started local companion using the installed Chrome.
export default defineConfig({
  testDir: "./apps/web/e2e",
  use: { baseURL: "http://127.0.0.1:3000", channel: "chrome" },
});
