import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/extension/e2e", workers: 1, retries: 0, timeout: 60_000,
  outputDir: ".goal-loop/evidence/extension-journal", reporter: "list",
});
