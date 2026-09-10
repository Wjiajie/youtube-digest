import { z } from "zod";
import { blueprintSnapshotSchema, goalBriefSchema } from "@blueprint/domain";
import { planningResultSchema, planningSkillSchema } from "./planning-result";

export const startPlanningRunSchema = z.strictObject({
  runId: z.uuid(), briefId: z.uuid(), expectedBriefRevision: z.int().min(1).max(2147483647), expectedBlueprintVersion: z.int().min(0).max(2147483647),
  startDate: z.iso.date().refine(value => !value.startsWith("0000-")),
});
const rowSchema = z.strictObject({
  id: z.uuid(), owner_id: z.uuid(), brief_id: z.uuid(), blueprint_id: z.uuid(),
  brief_revision: z.int().positive(), blueprint_version: z.int().nonnegative(), start_date: z.iso.date(),
  status: z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "stale"]),
  input_brief: goalBriefSchema, input_blueprint: blueprintSnapshotSchema,
  skill: planningSkillSchema.nullable(), result: planningResultSchema.nullable(),
  created_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
}).superRefine((row, context) => {
  const invalid = () => context.addIssue({ code: "custom", message: "Inconsistent planning checkpoint" });
  if (row.input_brief.id !== row.brief_id || row.input_brief.blueprintId !== row.blueprint_id
    || row.input_brief.revision !== row.brief_revision || row.input_brief.status !== "confirmed"
    || row.input_blueprint.id !== row.blueprint_id || row.input_blueprint.version !== row.blueprint_version) invalid();
  if ((row.status === "queued" || row.status === "running") && row.result !== null) invalid();
  if ((row.status === "ready" || row.status === "stale") && row.result?.status !== "ready") invalid();
  if (row.status === "cancelled" && row.result?.status !== "cancelled") invalid();
  if (row.status === "interrupted" && row.result?.status !== "timed_out") invalid();
  if (row.status === "failed" && (!row.result || row.result.status === "ready")) invalid();
  if (row.result?.status === "ready") {
    const source = row.result.source;
    if (source.runId !== row.id || source.briefId !== row.brief_id || source.briefRevision !== row.brief_revision
      || source.blueprintId !== row.blueprint_id || source.blueprintVersion !== row.blueprint_version || source.startDate !== row.start_date
      || JSON.stringify(row.result.skill) !== JSON.stringify(row.skill)) invalid();
  }
});

export function parsePlanningRun(input: unknown, ownerId: string, runId: string) {
  const row = rowSchema.parse(input);
  if (row.owner_id !== ownerId || row.id !== runId) throw new Error("Invalid planning checkpoint identity");
  return { id: row.id, ownerId: row.owner_id, briefId: row.brief_id, blueprintId: row.blueprint_id,
    briefRevision: row.brief_revision, blueprintVersion: row.blueprint_version, startDate: row.start_date,
    status: row.status, brief: row.input_brief, blueprint: row.input_blueprint, skill: row.skill, result: row.result,
    createdAt: row.created_at, expiresAt: row.expires_at };
}
export type PlanningRun = ReturnType<typeof parsePlanningRun>;
