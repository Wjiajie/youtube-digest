import { z } from "zod";
import { goalBriefContentSchema, goalBriefReadiness } from "@blueprint/domain";

const field = z.enum(["outcome", "startingPoint", "targetDate", "weeklyMinutes", "constraints", "successCriteria"]);
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
export const clarificationCandidateSchema = z.strictObject({
  reflection: text(1000),
  changes: z.array(z.strictObject({ field, value: z.union([z.string().max(4000), z.number(), z.null()]), quote: text(4000) })).max(6),
  question: z.strictObject({ field: z.enum([...field.options, "feasibility"]), text: text(1000) }).nullable(),
  concerns: z.array(text(500)).max(6), pause: z.strictObject({ quote: text(4000) }).nullable(),
});
export const clarificationSkillSchema = z.strictObject({
  name: z.literal("blueprint-clarify-goal"), version: z.string().max(64).regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), instructions: z.string().min(1).max(32000),
});
const usage = z.strictObject({ inputTokens: z.int().nonnegative().nullable(), outputTokens: z.int().nonnegative().nullable(), totalTokens: z.int().nonnegative().nullable() });
const suggestion = clarificationCandidateSchema.extend({
  status: z.enum(["needs_input", "reviewable", "paused"]), providerMayHaveRun: z.literal(true), usage,
  content: goalBriefContentSchema,
  readiness: z.strictObject({ missing: z.array(z.enum(["outcome", "startingPoint", "weeklyMinutes", "successCriteria"])).max(4),
    uncertainties: z.array(z.enum(["targetDate", "constraints"])).max(2) }),
  skill: clarificationSkillSchema,
  source: z.strictObject({ briefId: z.uuid(), briefRevision: z.int().positive(), blueprintId: z.uuid(), turnId: z.uuid() }),
}).superRefine((result, context) => {
  if (JSON.stringify(result.readiness) !== JSON.stringify(goalBriefReadiness(result.content))
    || (result.status === "needs_input" && (result.question === null || result.pause !== null))
    || (result.status === "paused" && (result.question !== null || result.pause === null))
    || (result.status === "reviewable" && (result.question !== null || result.pause !== null || result.readiness.missing.length > 0 || result.concerns.length > 0))) {
    context.addIssue({ code: "custom", message: "Inconsistent clarification suggestion" });
  }
});
export const clarificationResultSchema = z.union([suggestion, z.strictObject({
  status: z.enum(["invalid_input", "unavailable", "invalid_output", "cancelled", "timed_out"]),
  providerMayHaveRun: z.boolean(), usage: usage.nullable(),
})]);
export type ClarificationResult = z.infer<typeof clarificationResultSchema>;
