import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  outputFileTracingIncludes: {
    "/api/planning/runs": ["./src/lib/agent/skills/plan-path/v1/SKILL.md"],
    "/api/clarification/turns": ["./src/lib/agent/skills/clarify-goal/v1/SKILL.md"],
    "/api/resources/runs": ["./src/lib/agent/skills/match-resources/v1/SKILL.md"],
  },
};

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
});
