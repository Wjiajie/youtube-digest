import { defineConfig } from "@playwright/test";
import journal from "./playwright.journal.config";
export default defineConfig({ ...journal, testDir: "./apps/web/planning-e2e", outputDir: ".goal-loop/evidence/planning-review" });
