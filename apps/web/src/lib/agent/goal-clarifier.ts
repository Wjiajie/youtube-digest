import { z } from "zod";
import type { LanguageModel } from "ai";
import { goalBriefSchema, goalBriefContentSchema, goalBriefReadiness } from "@blueprint/domain";
import { loadClarificationSkill } from "./clarification-skill";
import { generateStructuredSkill, type SkillUsage } from "./structured-skill-generation";
import { clarificationCandidateSchema, type ClarificationResult } from "./clarification-result";

const text = (limit: number) => z.string().min(1).max(limit).refine(value => value.trim().length > 0);
const requestSchema = z.strictObject({
  turnId: z.uuid(), signal: z.instanceof(AbortSignal), brief: goalBriefSchema,
  workingContent: goalBriefContentSchema.optional(),
  message: text(8_000), history: z.array(z.strictObject({ question: text(1_000), answer: text(8_000) })).max(12),
  expectedSkillSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

/** Produces a review suggestion only. Callers must separately authorize, persist and confirm it. */
export function createGoalClarifier(dependencies: { model: Exclude<LanguageModel, string> }) {
  return {
    async run(input: unknown): Promise<ClarificationResult> {
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null };
      const { brief, message, history, turnId, signal } = parsed.data;
      const workingContent = parsed.data.workingContent ?? brief.content;
      if (brief.status !== "draft") return { status: "invalid_input" as const, providerMayHaveRun: false, usage: null };
      if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun: false, usage: null };
      let usage: SkillUsage | null = null;
      let providerMayHaveRun = false;
      try {
        const skill = await loadClarificationSkill();
        if (parsed.data.expectedSkillSha256 && parsed.data.expectedSkillSha256 !== skill.identity.sha256) {
          return { status: "unavailable" as const, providerMayHaveRun, usage };
        }
        const result = await generateStructuredSkill({ model: dependencies.model, instructions: skill.instructions,
          schema: clarificationCandidateSchema, maxOutputTokens: 8_000, signal,
          prompt: JSON.stringify({ brief: workingContent, history, message }),
        });
        if (result.status !== "generated") return result;
        usage = result.usage;
        providerMayHaveRun = result.providerMayHaveRun;
        const candidate = result.output;
        const merged = goalBriefContentSchema.safeParse({ ...workingContent, ...Object.fromEntries(candidate.changes.map(change => [change.field, change.value])) });
        if (!merged.success || new Set(candidate.changes.map(change => change.field)).size !== candidate.changes.length ||
          candidate.changes.some(change => !message.includes(change.quote))) {
          return { status: "invalid_output" as const, providerMayHaveRun, usage };
        }
        const content = merged.data;
        const readiness = goalBriefReadiness(content);
        if (candidate.pause !== null && (candidate.question !== null || !message.includes(candidate.pause.quote))) {
          return { status: "invalid_output" as const, providerMayHaveRun, usage };
        }
        if (candidate.pause === null && candidate.question === null && (readiness.missing.length > 0 || candidate.concerns.length > 0)) {
          return { status: "invalid_output" as const, providerMayHaveRun, usage };
        }
        return { status: candidate.pause !== null ? "paused" as const : candidate.question === null ? "reviewable" as const : "needs_input" as const,
          providerMayHaveRun: true, usage, ...candidate, content, readiness,
          skill: { ...skill.identity, instructions: skill.instructions },
          source: { briefId: brief.id, briefRevision: brief.revision, blueprintId: brief.blueprintId, turnId },
        };
      } catch {
        if (signal.aborted) return { status: "cancelled" as const, providerMayHaveRun, usage };
        return { status: "unavailable" as const, providerMayHaveRun, usage };
      }
    },
  };
}
