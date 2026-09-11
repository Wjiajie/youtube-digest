import { explanationSelectionSchema, explanationAnswerSchema, explanationAnswerMatches, selectExplanationEvidence } from "@blueprint/domain";
import { z } from "zod";
import type { TranscriptPage, TranslationContext } from "./translation-view";

export type ExplanationSelection = z.infer<typeof explanationSelectionSchema>;
export type ExplanationContext = TranslationContext & { selection: ExplanationSelection; question: string };
export type ExplanationPort = {
  find(input: ExplanationContext, signal: AbortSignal): Promise<unknown>;
  start(input: ExplanationContext & { runId: string }, signal: AbortSignal): Promise<unknown>;
  read(input: ExplanationContext & { runId: string }, signal: AbortSignal): Promise<unknown>;
  cancel(input: ExplanationContext & { runId: string }, signal: AbortSignal): Promise<unknown>;
};
const id = z.uuid().transform(value => value.toLowerCase());
const instant = z.iso.datetime({ offset: true });
const question = z.string().max(1000).refine(value => !/[\uD800-\uDFFF]/u.test(value) && !value.includes("\0"));
const commandContext = z.strictObject({ bindingId: id, videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), sourceRunId: id,
  offset: z.int().min(0).max(19999).multipleOf(20), targetLanguage: z.literal("zh-Hans"), selection: explanationSelectionSchema, question });
/** A closed, content-minimal message. Original text and arbitrary URLs are never commands. */
export const explanationCommand = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("find"), context: commandContext }),
  z.strictObject({ operation: z.enum(["start", "read", "cancel"]), context: commandContext, runId: id }),
]);
const status = z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "cleared"]);
const count = z.int().nonnegative().nullable();
const usage = z.strictObject({ inputTokens: count, outputTokens: count, totalTokens: count }).nullable();
const outcome = z.discriminatedUnion("status", [
  z.strictObject({ status: z.enum(["explained", "insufficient_context"]), providerMayHaveRun: z.literal(true), usage, answer: explanationAnswerSchema }),
  z.strictObject({ status: z.enum(["invalid_input", "no_evidence", "unavailable", "cancelled", "timed_out", "invalid_output", "expired"]), providerMayHaveRun: z.boolean(), usage }),
]);
export const explanationAck = z.strictObject({ ok: z.literal(true), runId: z.uuid(), status });
const projection = z.strictObject({ runId: z.uuid(), accountId: z.uuid(), status,
  context: commandContext.omit({ targetLanguage: true, selection: true, question: true }), targetLanguage: z.literal("zh-Hans"),
  contentExpiresAt: instant, observedAt: instant.nullable(), selection: explanationSelectionSchema.nullable(), question: question.nullable(), result: outcome.nullable(),
}).superRefine((run, ctx) => {
  if (run.status === "cleared") {
    if ([run.selection, run.question, run.result, run.observedAt].some(value => value !== null))
      ctx.addIssue({ code: "custom", message: "Invalid explanation tombstone" });
    return;
  }
  const active = run.status === "queued" || run.status === "running";
  const answered = run.result?.status === "explained" || run.result?.status === "insufficient_context";
  if (run.selection === null || run.question === null || run.observedAt === null || Date.parse(run.observedAt) >= Date.parse(run.contentExpiresAt)
    || active !== (run.result === null) || (run.status === "ready") !== answered
    || run.status === "cancelled" && run.result?.status !== "cancelled" || run.status === "interrupted" && run.result?.status !== "timed_out"
    || run.status === "failed" && ["cancelled", "timed_out"].includes(run.result?.status ?? "")
    || answered && run.result && "answer" in run.result && (run.result.status === "explained") !== (run.result.answer.kind === "explanation"))
    ctx.addIssue({ code: "custom", message: "Invalid explanation state" });
});
export const explanationResponse = z.strictObject({ ok: z.literal(true), run: projection.nullable() });
export type ExplanationView = NonNullable<z.infer<typeof explanationResponse>["run"]>;

export function selectedExplanationText(page: TranscriptPage, selection: ExplanationSelection): string {
  return selectExplanationEvidence(page, explanationSelectionSchema.parse(selection)).selected.map(part => part.text).join("\n");
}

/** Only a freshly read matching page may expose the learner's question or answer. */
export function parseExplanationView(input: unknown, page: TranscriptPage, context: ExplanationContext, runId?: string): ExplanationView | null {
  const command = commandContext.parse(context), run = explanationResponse.parse(input).run;
  if (command.bindingId !== page.context.bindingId || command.videoId !== page.context.videoId || command.sourceRunId !== page.sourceRunId || command.offset !== page.offset)
    throw new Error("Explanation source changed");
  const evidence = selectExplanationEvidence(page, command.selection);
  if (!run) { if (runId) throw new Error("Missing explanation"); return null; }
  if (run.accountId !== page.ownerId || runId && run.runId !== runId || run.context.bindingId !== command.bindingId || run.context.videoId !== command.videoId
    || run.context.sourceRunId !== command.sourceRunId || run.context.offset !== command.offset
    || Date.parse(run.contentExpiresAt) !== Date.parse(page.contentExpiresAt)) throw new Error("Explanation context changed");
  if (run.status !== "cleared" && (run.question !== command.question || JSON.stringify(run.selection) !== JSON.stringify(command.selection)
    || Date.parse(run.observedAt!) < Date.parse(page.sourceCreatedAt))) throw new Error("Explanation request changed");
  if (run.result && "answer" in run.result && !explanationAnswerMatches(run.result.answer, evidence)) throw new Error("Invalid explanation evidence");
  return run;
}

/** Stable UUIDv8 namespace and field order across both clients. This is request
 * identity, never authority: recovery still verifies the source and account. */
export async function explanationAttemptId(page: TranscriptPage, context: ExplanationContext, predecessor: string | null): Promise<string> {
  const command = commandContext.parse(context);
  parseExplanationView({ ok: true, run: null }, page, command);
  const previous = predecessor === null ? null : id.parse(predecessor);
  const name = JSON.stringify(["blueprint/explanation-attempt/v1", page.ownerId.toLowerCase(), command.bindingId,
    command.videoId, command.sourceRunId, command.offset, command.targetLanguage,
    command.selection.start.segmentIndex, command.selection.start.charOffset, command.selection.end.segmentIndex, command.selection.end.charOffset,
    command.question, previous]);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name))).slice(0, 16);
  const hex = [...bytes].map((byte, index) => {
    const value = index === 6 ? (byte & 0x0f) | 0x80 : index === 8 ? (byte & 0x3f) | 0x80 : byte;
    return value.toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
