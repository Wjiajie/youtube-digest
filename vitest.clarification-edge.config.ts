import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  include: ["apps/web/clarification-edge-integration/**/*.spec.ts"],
  globalSetup: ["./scripts/planning-edge-test-setup.mjs"],
  fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000,
} });
