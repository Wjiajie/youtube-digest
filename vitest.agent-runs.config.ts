import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  include: ["apps/web/agent-integration/**/*.spec.ts"],
  fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000,
} });
