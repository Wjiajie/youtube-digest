import { z } from "zod";
import { blueprintSnapshotSchema } from "@blueprint/domain";

export const planningUsageSchema = z.strictObject({
  inputTokens: z.int().nonnegative().nullable(), outputTokens: z.int().nonnegative().nullable(), totalTokens: z.int().nonnegative().nullable(),
});
export const planningSkillSchema = z.strictObject({
  name: z.literal("blueprint-plan-path"), version: z.string().max(64).regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), instructions: z.string().min(1).max(32_000),
});
export const planningResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.enum(["invalid_input", "needs_confirmation", "unavailable", "invalid_output", "cancelled", "timed_out"]),
    providerMayHaveRun: z.boolean(), usage: planningUsageSchema.nullable(),
  }),
  z.strictObject({
    status: z.literal("ready"), providerMayHaveRun: z.literal(true), usage: planningUsageSchema,
    draft: blueprintSnapshotSchema.refine(snapshot => snapshot.schemaVersion === 2),
    schedule: z.array(z.strictObject({ nodeId: z.uuid(), week: z.int().min(1).max(26) })).min(1).max(128),
    assumptions: z.array(z.string().max(500)).max(8), skill: planningSkillSchema,
    source: z.strictObject({ runId: z.uuid(), briefId: z.uuid(), briefRevision: z.int().positive(),
      blueprintId: z.uuid(), blueprintVersion: z.int().nonnegative(), startDate: z.iso.date() }),
  }),
]);
export type PlanningResult = z.infer<typeof planningResultSchema>;
export type PlanningUsage = z.infer<typeof planningUsageSchema>;
