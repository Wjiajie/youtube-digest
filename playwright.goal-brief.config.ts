import { defineConfig } from "@playwright/test";
import journal from "./playwright.journal.config";

export default defineConfig({ ...journal, testDir: "./apps/web/goal-brief-e2e", outputDir: ".goal-loop/evidence/goal-brief" });
