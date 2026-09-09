import { defineConfig } from "@playwright/test";
import journal from "./playwright.journal.config";

export default defineConfig({ ...journal, testDir: "./apps/web/node-planning-e2e", outputDir: ".goal-loop/evidence/node-planning" });
