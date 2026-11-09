import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  // Local development databases and credentials are never server artifacts.
  outputFileTracingExcludes: {
    "*": ["../../.local/**/*", "./.env*"],
  },
  outputFileTracingIncludes: {
    "/api/companion": ["./src/lib/agent/skills/plan-path/v1/SKILL.md"],
    "/api/companion/assets": ["./src/lib/companion/animations/*"],
    "/api/planning/runs": ["./src/lib/agent/skills/plan-path/v1/SKILL.md"],
    "/api/clarification/turns": [
      "./src/lib/agent/skills/clarify-goal/v1/SKILL.md",
    ],
    "/api/resources/runs": [
      "./src/lib/agent/skills/match-resources/v1/SKILL.md",
    ],
    "/api/translations/runs": [
      "./src/lib/agent/skills/translate-transcript/v1/SKILL.md",
    ],
    "/api/explanations/runs": [
      "./src/lib/agent/skills/explain-selection/v1/SKILL.md",
    ],
    "/api/v1/explanations/runs": [
      "./src/lib/agent/skills/explain-selection/v1/SKILL.md",
    ],
  },
};

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
});
