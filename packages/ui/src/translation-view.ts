import { z } from "zod";
import type { LearningTranscript } from "@blueprint/domain";

export type TranscriptPage = Extract<LearningTranscript, { status: "ready" }>;
export type TranslationContext = { bindingId: string; videoId: string; sourceRunId: string; offset: number; targetLanguage: "zh-Hans" };
export type TranslationPort = {
  find(input: TranslationContext, signal: AbortSignal): Promise<unknown>;
  start(input: TranslationContext & { runId: string }, signal: AbortSignal): Promise<unknown>;
  read(runId: string, signal: AbortSignal): Promise<unknown>;
  cancel(runId: string, signal: AbortSignal): Promise<unknown>;
};
const instant = z.iso.datetime({ offset: true });
const count = z.int().nonnegative().nullable();
const usage = z.strictObject({ inputTokens: count, outputTokens: count, totalTokens: count }).nullable();
const outcome = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("translated"), providerMayHaveRun: z.literal(true), usage,
    segments: z.array(z.strictObject({ segmentIndex: z.int().nonnegative(), translation: z.string().min(1).max(20000).refine(text => !!text.trim()) })).min(1).max(20) }),
  z.strictObject({ status: z.enum(["invalid_input", "no_evidence", "unavailable", "cancelled", "timed_out", "invalid_output", "expired"]), providerMayHaveRun: z.boolean(), usage }),
]);
const status = z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "cleared"]);
export const translationAck = z.strictObject({ ok: z.literal(true), runId: z.uuid(), status });
const response = z.strictObject({ ok: z.literal(true), run: z.strictObject({
  runId: z.uuid(), accountId: z.uuid(), status,
  context: z.strictObject({ bindingId: z.uuid(), videoId: z.string(), sourceRunId: z.uuid(), offset: z.int().nonnegative() }),
  targetLanguage: z.literal("zh-Hans"), contentExpiresAt: instant, observedAt: instant.nullable(), result: outcome.nullable(),
}).nullable() });
export type TranslationView = NonNullable<z.infer<typeof response>["run"]>;

/** A versioned, name-based UUIDv8 attempt key. Same page + same confirmed predecessor
 * survives remount/reload before begin is visible in SQL; identity is not authorization.
 * Keep this namespace and field order stable across clients and releases. */
export async function translationAttemptId(page: TranscriptPage, predecessor: string | null): Promise<string> {
  const name = JSON.stringify(["blueprint/translation-attempt/v1", page.ownerId.toLowerCase(), page.context.bindingId.toLowerCase(),
    page.context.videoId, page.sourceRunId.toLowerCase(), page.offset, "zh-Hans", predecessor?.toLowerCase() ?? null]);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name))).slice(0, 16);
  const hex = [...bytes].map((byte, index) => {
    const value = index === 6 ? (byte & 0x0f) | 0x80 : index === 8 ? (byte & 0x3f) | 0x80 : byte;
    return value.toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Only the minimal public projection is accepted; persistence receipts never belong in the browser. */
export function parseTranslationView(input: unknown, page: TranscriptPage, runId?: string): TranslationView | null {
  const run = response.parse(input).run;
  if (!run) { if (runId) throw new Error("Missing translation"); return null; }
  if (run.accountId !== page.ownerId || runId && run.runId !== runId || run.context.bindingId !== page.context.bindingId
    || run.context.videoId !== page.context.videoId || run.context.sourceRunId !== page.sourceRunId || run.context.offset !== page.offset
    || Date.parse(run.contentExpiresAt) !== Date.parse(page.contentExpiresAt)) throw new Error("Translation context changed");
  const active = run.status === "queued" || run.status === "running";
  if ((active || run.status === "cleared") !== (run.result === null)
    || (run.status === "ready") !== (run.result?.status === "translated")
    || (run.status === "ready") !== (run.observedAt !== null)
    || run.status === "cancelled" && run.result?.status !== "cancelled"
    || run.status === "interrupted" && run.result?.status !== "timed_out") throw new Error("Invalid translation state");
  if (run.result?.status === "translated" && (run.result.segments.length !== page.segments.length
    || run.result.segments.some((segment, index) => segment.segmentIndex !== page.offset + index))) throw new Error("Translation correspondence changed");
  return run;
}
