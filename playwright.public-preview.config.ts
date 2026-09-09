import { defineConfig } from "@playwright/test";
import journal from "./playwright.journal.config";
export default defineConfig({ ...journal, testDir: "./apps/web/public-preview-e2e", timeout: 90_000,
  outputDir: ".goal-loop/evidence/public-preview" });
