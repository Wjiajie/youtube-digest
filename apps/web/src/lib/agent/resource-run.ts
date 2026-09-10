import { z } from "zod";
import { createHash } from "node:crypto";
import { blueprintSnapshotSchema } from "@blueprint/domain";
import { resourcePreferencesSchema } from "../resources/discovery";
import { discoveredResourcesSchema, noCandidatesSchema, resourceRequestsSchema } from "../resources/evidence";
import { matchedResourcesSchema, resourceSkillSchema } from "./resource-match-contract";
import { planningUsageSchema } from "./planning-result";

const learnerContextSchema = z.strictObject({ startingPoint: z.string().max(2000).nullable(), constraints: z.string().max(2000).nullable() });
export const startResourceRunSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("discover"), runId: z.uuid(), nodeId: z.uuid(), expectedBlueprintVersion: z.int().nonnegative().max(2147483647), preferences: resourcePreferencesSchema, learnerContext: learnerContextSchema }),
  z.strictObject({ kind: z.enum(["captions", "match"]), runId: z.uuid(), sourceRunId: z.uuid() }),
]);
export type ResourceCommand = z.infer<typeof startResourceRunSchema>;
export const resourceResultSchema = z.union([discoveredResourcesSchema, noCandidatesSchema, matchedResourcesSchema,
  z.strictObject({ status: z.enum(["invalid_input", "not_applicable", "unavailable", "rate_limited", "cancelled", "timed_out", "not_found", "invalid_output", "no_evidence"]),
    requests: resourceRequestsSchema.optional(), providerMayHaveRun: z.boolean().optional(), usage: planningUsageSchema.nullable().optional() }),
]);
const rowSchema = z.strictObject({
  id: z.uuid(), owner_id: z.uuid(), blueprint_id: z.uuid(), blueprint_version: z.int().nonnegative(), node_id: z.uuid(),
  kind: z.enum(["discover", "captions", "match"]), source_run_id: z.uuid().nullable(), preferences: resourcePreferencesSchema, learner_context: learnerContextSchema,
  input_blueprint: blueprintSnapshotSchema, input_discovery: discoveredResourcesSchema.nullable(), skill: resourceSkillSchema.nullable(), result: resourceResultSchema.nullable(),
  status: z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "stale"]), created_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
}).superRefine((row, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "Inconsistent resource record" });
  const sourceMatches = (source: { blueprintId: string; blueprintVersion: number; nodeId: string }) =>
    source.blueprintId === row.blueprint_id && source.blueprintVersion === row.blueprint_version && source.nodeId === row.node_id;
  if (row.input_blueprint.id !== row.blueprint_id || row.input_blueprint.version !== row.blueprint_version ||
    !row.input_blueprint.goals.some(goal => goal.stages.some(stage => stage.nodes.some(node => node.id === row.node_id && node.type === "learn")))) invalid();
  if (row.kind === "discover" ? row.source_run_id !== null || row.input_discovery !== null : row.source_run_id === null || row.input_discovery === null) invalid();
  if (row.input_discovery && !sourceMatches(row.input_discovery.source)) invalid();
  if (["queued", "running"].includes(row.status) !== (row.result === null)) invalid();
  if ((row.kind !== "match" || row.status === "queued") && row.skill !== null) invalid();
  if (row.kind === "match" && row.status === "running" && row.skill === null) invalid();
  if (row.skill && createHash("sha256").update(row.skill.instructions).digest("hex") !== row.skill.sha256) invalid();
  const result = row.result;
  const success = result && ["discovered", "no_candidates", "matched", "no_match", "no_evidence"].includes(result.status);
  if (["ready", "stale"].includes(row.status) && !success) invalid();
  if (result && "source" in result && !sourceMatches(result.source)) invalid();
  if (result && "assessments" in result && (row.kind !== "match" || !row.skill || result.skill.sha256 !== row.skill.sha256 || result.skill.version !== row.skill.version)) invalid();
  if (result && ["discovered", "no_candidates"].includes(result.status) && row.kind === "match") invalid();
  for (const evidence of [row.input_discovery, result?.status === "discovered" ? result : null]) {
    if (!evidence) continue;
    for (const candidate of evidence.candidates) {
      const fallback = candidate.transcript.status === "ready" ? candidate.transcript.language.toLowerCase() !== row.preferences.language.toLowerCase() : null;
      if (candidate.languageFallback !== fallback || candidate.eligibleForMatching !== (candidate.transcript.status === "ready" && (!fallback || row.preferences.allowLanguageFallback))) invalid();
    }
  }
});
export function parseResourceRun(input: unknown, ownerId: string, runId: string) {
  const row = rowSchema.parse(input);
  if (row.owner_id !== ownerId || row.id !== runId) throw new Error("Invalid resource record identity");
  return { id: row.id, ownerId: row.owner_id, blueprintId: row.blueprint_id, blueprintVersion: row.blueprint_version, nodeId: row.node_id,
    kind: row.kind, sourceRunId: row.source_run_id, preferences: row.preferences, learnerContext: row.learner_context, blueprint: row.input_blueprint,
    discovery: row.input_discovery, skill: row.skill, result: row.result, status: row.status, createdAt: row.created_at, expiresAt: row.expires_at };
}
export type ResourceRun = ReturnType<typeof parseResourceRun>;
