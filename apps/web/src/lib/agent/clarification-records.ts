import { z } from "zod";
import { goalBriefSchema, goalBriefContentSchema, goalBriefReadiness } from "@blueprint/domain";
import { createHash } from "node:crypto";
import { clarificationResultSchema, clarificationSkillSchema } from "./clarification-result";

const sessionRowSchema = z.strictObject({
  id: z.uuid(), owner_id: z.uuid(), brief_id: z.uuid(), blueprint_id: z.uuid(), brief_revision: z.int().positive(),
  input_brief: goalBriefSchema, content: goalBriefContentSchema, revision: z.int().positive(),
  status: z.enum(["active", "closed", "stale"]), mode: z.enum(["needs_input", "reviewable", "paused"]),
  question: z.string().min(1).max(1000), created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
}).superRefine((row, context) => {
  if (row.input_brief.id !== row.brief_id || row.input_brief.blueprintId !== row.blueprint_id
    || row.input_brief.revision !== row.brief_revision || row.input_brief.status !== "draft"
    || (row.mode === "reviewable" && goalBriefReadiness(row.content).missing.length > 0)) {
    context.addIssue({ code: "custom", message: "Inconsistent clarification session" });
  }
});

export function parseClarificationSession(input: unknown, ownerId: string, sessionId: string) {
  const row = sessionRowSchema.parse(input);
  if (row.owner_id !== ownerId || row.id !== sessionId) throw new Error("Invalid clarification session identity");
  return { id: row.id, ownerId: row.owner_id, briefId: row.brief_id, blueprintId: row.blueprint_id,
    briefRevision: row.brief_revision, sourceBrief: row.input_brief, content: row.content, revision: row.revision,
    status: row.status, mode: row.mode, question: row.question, createdAt: row.created_at, updatedAt: row.updated_at };
}
export type ClarificationSession = ReturnType<typeof parseClarificationSession>;

const turnRowSchema = z.strictObject({
  id: z.uuid(), owner_id: z.uuid(), session_id: z.uuid(), ordinal: z.int().positive(), session_revision: z.int().positive(),
  input_brief: goalBriefSchema, input_content: goalBriefContentSchema, input_question: z.string().min(1).max(1000),
  input_message: z.string().min(1).max(8000),
  input_history: z.array(z.strictObject({ question: z.string().min(1).max(1000), answer: z.string().min(1).max(8000) })).max(12),
  status: z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "stale"]),
  skill: clarificationSkillSchema.nullable(), result: clarificationResultSchema.nullable(),
  created_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
}).superRefine((row, context) => {
  const invalid = () => context.addIssue({ code: "custom", message: "Inconsistent clarification turn" });
  if (row.input_brief.status !== "draft" || ((row.status === "queued" || row.status === "running") !== (row.result === null))
    || (row.status === "queued" && row.skill !== null) || (row.status === "running" && row.skill === null)) invalid();
  if (row.skill && row.skill.sha256 !== createHash("sha256").update(row.skill.instructions).digest("hex")) invalid();
  const result = row.result;
  if (row.status === "ready" && (!result || !("content" in result))) invalid();
  if (row.status === "cancelled" && result?.status !== "cancelled") invalid();
  if (row.status === "interrupted" && result?.status !== "timed_out") invalid();
  if (result && "content" in result) {
    if (row.status !== "ready" || result.source.turnId !== row.id || result.source.briefId !== row.input_brief.id
      || result.source.briefRevision !== row.input_brief.revision || result.source.blueprintId !== row.input_brief.blueprintId
      || JSON.stringify(result.skill) !== JSON.stringify(row.skill)) invalid();
    const merged = goalBriefContentSchema.safeParse({ ...row.input_content, ...Object.fromEntries(result.changes.map(change => [change.field, change.value])) });
    if (!merged.success || JSON.stringify(merged.data) !== JSON.stringify(result.content)
      || new Set(result.changes.map(change => change.field)).size !== result.changes.length
      || result.changes.some(change => !row.input_message.includes(change.quote))
      || (result.pause && !row.input_message.includes(result.pause.quote))) invalid();
  }
});

export function parseClarificationTurn(input: unknown, ownerId: string, turnId: string) {
  const row = turnRowSchema.parse(input);
  if (row.owner_id !== ownerId || row.id !== turnId) throw new Error("Invalid clarification turn identity");
  return { id: row.id, ownerId: row.owner_id, sessionId: row.session_id, ordinal: row.ordinal, sessionRevision: row.session_revision,
    sourceBrief: row.input_brief, workingContent: row.input_content, inputQuestion: row.input_question, message: row.input_message,
    history: row.input_history, status: row.status, skill: row.skill, result: row.result, createdAt: row.created_at, expiresAt: row.expires_at };
}
export type ClarificationTurn = ReturnType<typeof parseClarificationTurn>;
