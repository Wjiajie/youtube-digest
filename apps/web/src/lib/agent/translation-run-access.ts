import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { parseTranslationRun, type TranslationRun } from "./translation-run";

const id = z.uuid().transform(value => value.toLowerCase());
const beginSchema = z.strictObject({ runId: id, bindingId: id, videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  sourceRunId: id, offset: z.int().min(0).max(19999).multipleOf(20), targetLanguage: z.literal("zh-Hans") });
type FailureCode = "forbidden" | "not_found" | "invalid" | "quota_exhausted" | "busy" | "unavailable" | "cancelled";
export type TranslationRunResponse = { ok: true; run: TranslationRun } | { ok: false; code: FailureCode };
export function translationRunFailure(error: { code?: string; message?: string }): { ok: false; code: FailureCode } {
  if (error.code === "42501") return { ok: false, code: "forbidden" };
  if (error.code === "P0002") return { ok: false, code: "not_found" };
  if (["22023", "23514"].includes(error.code ?? "")) return { ok: false, code: "invalid" };
  if (error.code === "P0001" && error.message === "TRANSLATION_QUOTA_EXHAUSTED") return { ok: false, code: "quota_exhausted" };
  if (error.code === "P0001" && error.message === "TRANSLATION_BUSY") return { ok: false, code: "busy" };
  return { ok: false, code: "unavailable" };
}

/** Caller-scoped persistence only. No execution credentials, model calls or implicit generation. */
export function createTranslationRunAccess(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity };
  const allowed = actor.client === "web" && id.safeParse(actor.userId).success;
  async function request(name: string, args: Record<string, unknown>, runId: string, signal?: AbortSignal): Promise<TranslationRunResponse> {
    try {
      const query = client.rpc(name, args);
      const { data, error } = await (signal ? query.abortSignal(signal) : query);
      return error ? translationRunFailure(error) : { ok: true, run: parseTranslationRun(data, actor.userId, runId) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  async function command(name: string, runId: string, signal?: AbortSignal): Promise<TranslationRunResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    const parsed = id.safeParse(runId);
    if (!parsed.success) return { ok: false, code: "invalid" };
    return request(name, { p_run_id: parsed.data }, parsed.data, signal);
  }
  return {
    async begin(input: unknown): Promise<TranslationRunResponse> {
      if (!allowed) return { ok: false, code: "forbidden" };
      const parsed = beginSchema.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const result = await request("begin_translation_run", { p_request: parsed.data }, parsed.data.runId);
      if (result.ok && (result.run.binding_id !== parsed.data.bindingId || result.run.video_id !== parsed.data.videoId
        || result.run.source_run_id !== parsed.data.sourceRunId || result.run.page_offset !== parsed.data.offset
        || result.run.target_language !== parsed.data.targetLanguage)) return { ok: false, code: "unavailable" };
      return result;
    },
    read: (runId: string, signal?: AbortSignal) => command("read_translation_run", runId, signal),
    cancel: (runId: string) => command("cancel_translation_run", runId),
  };
}
