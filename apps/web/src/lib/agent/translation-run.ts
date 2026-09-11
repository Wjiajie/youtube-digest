import { z } from "zod";
import { createHash } from "node:crypto";
import { parseLearningTranscript } from "@blueprint/domain";

const instant = z.iso.datetime({ offset: true });
const tokenCount = z.int().nonnegative().nullable();
const completionSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("translated"), providerMayHaveRun: z.literal(true),
    usage: z.strictObject({ inputTokens: tokenCount, outputTokens: tokenCount, totalTokens: tokenCount }).nullable(),
    segments: z.array(z.strictObject({ segmentIndex: z.int().min(0).max(19999),
      translation: z.string().min(1).max(20000).refine(value => value.trim().length > 0) })).min(1).max(20) }),
  z.strictObject({ status: z.enum(["invalid_input", "no_evidence", "unavailable", "cancelled", "timed_out", "invalid_output", "expired"]),
    providerMayHaveRun: z.boolean(), usage: z.strictObject({ inputTokens: tokenCount, outputTokens: tokenCount, totalTokens: tokenCount }).nullable() }),
]);
const runSchema = z.strictObject({
  id: z.uuid(), owner_id: z.uuid(), blueprint_id: z.uuid(), node_id: z.uuid(), binding_id: z.uuid(),
  video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/), source_run_id: z.uuid(), page_offset: z.int().min(0).max(19999).multipleOf(20),
  target_language: z.literal("zh-Hans"), status: z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "cleared"]),
  created_at: instant, expires_at: instant, source_started_at: instant, content_expires_at: instant,
  retention_policy_ref: z.string().min(1).max(200), input_page: z.unknown(),
  skill: z.strictObject({ name: z.literal("blueprint-translate-transcript"), version: z.literal("1.0.0"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), instructions: z.string().min(1).max(32000) }).nullable(),
  model: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/).nullable(), result: completionSchema.nullable(),
  cleared_at: instant.nullable(), clear_reason: z.enum(["manual", "expired", "source_changed"]).nullable(),
});

/** Strict database receipt, pinned to the verified account and requested generation. */
export function parseTranslationRun(input: unknown, ownerId: string, runId: string) {
  const run = runSchema.parse(input);
  if (run.owner_id !== ownerId || run.id !== runId) throw new Error("Invalid translation identity");
  if (Date.parse(run.source_started_at) > Date.parse(run.created_at)
    || Date.parse(run.created_at) >= Date.parse(run.content_expires_at)
    || Date.parse(run.expires_at) <= Date.parse(run.created_at)) throw new Error("Invalid translation lifetime");
  if (run.skill && createHash("sha256").update(run.skill.instructions).digest("hex") !== run.skill.sha256)
    throw new Error("Invalid translation skill");
  if (run.status === "cleared") {
    if (run.input_page !== null || run.skill !== null || run.model !== null || run.result !== null
      || !run.cleared_at || !run.clear_reason) throw new Error("Invalid translation tombstone");
    return { ...run, input_page: null };
  }
  if (run.cleared_at !== null || run.clear_reason !== null || (run.skill === null) !== (run.model === null))
    throw new Error("Invalid translation state");
  const active = run.status === "queued" || run.status === "running";
  if (active !== (run.result === null) || run.status === "queued" && run.skill !== null
    || ["running", "ready", "failed", "interrupted"].includes(run.status) && run.skill === null
    || (run.status === "ready") !== (run.result?.status === "translated")
    || run.status === "cancelled" && run.result?.status !== "cancelled"
    || run.status === "interrupted" && run.result?.status !== "timed_out") throw new Error("Invalid translation outcome");
  const page = parseLearningTranscript(run.input_page, ownerId, {
    bindingId: run.binding_id, videoId: run.video_id, sourceRunId: run.source_run_id, offset: run.page_offset,
  });
  if (page.status !== "ready" || !page.segments.length || page.context.nodeId !== run.node_id
    || Date.parse(page.contentExpiresAt) !== Date.parse(run.content_expires_at)) throw new Error("Invalid translation source");
  if (run.result?.status === "translated" && (run.result.segments.length !== page.segments.length
    || run.result.segments.some((segment, index) => segment.segmentIndex !== run.page_offset + index)))
    throw new Error("Invalid translation correspondence");
  return { ...run, input_page: page };
}
export type TranslationRun = ReturnType<typeof parseTranslationRun>;
