import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { parseExplanationRun, type ExplanationRun } from "./explanation-run";
import { explanationSelectionSchema } from "./explanation-evidence";

const id = z.uuid().transform(value => value.toLowerCase());
export const startExplanationRunSchema = z.strictObject({ runId: id, bindingId: id, videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  sourceRunId: id, offset: z.int().min(0).max(19999).multipleOf(20), targetLanguage: z.literal("zh-Hans"),
  selection: explanationSelectionSchema, question: z.string().max(1000) });
const findSchema = startExplanationRunSchema.omit({ runId: true });
type FailureCode = "forbidden" | "not_found" | "invalid" | "quota_exhausted" | "busy" | "unavailable" | "cancelled";
export type ExplanationRunResponse = { ok: true; run: ExplanationRun } | { ok: false; code: FailureCode };
export function explanationRunFailure(error: { code?: string; message?: string }): { ok: false; code: FailureCode } {
  if (error.code === "42501") return { ok: false, code: "forbidden" };
  if (error.code === "P0002") return { ok: false, code: "not_found" };
  if (["22023", "23514"].includes(error.code ?? "")) return { ok: false, code: "invalid" };
  if (error.code === "P0001" && error.message === "EXPLANATION_QUOTA_EXHAUSTED") return { ok: false, code: "quota_exhausted" };
  if (error.code === "P0001" && error.message === "EXPLANATION_BUSY") return { ok: false, code: "busy" };
  return { ok: false, code: "unavailable" };
}

/** Caller persistence only. Actual JWT / exact extension authorization is enforced
 * by the RPC; this adapter never gains service credentials or starts inference. */
export function createExplanationRunAccess(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity };
  const allowed = (actor.client === "web" || actor.client === "extension") && id.safeParse(actor.userId).success;
  async function request(name: string, args: Record<string, unknown>, runId: string, signal?: AbortSignal): Promise<ExplanationRunResponse> {
    if (signal?.aborted) return { ok: false, code: "cancelled" };
    try {
      const query = client.rpc(name, args);
      const { data, error } = await (signal ? query.abortSignal(signal) : query);
      if (signal?.aborted) return { ok: false, code: "cancelled" };
      return error ? explanationRunFailure(error) : { ok: true, run: parseExplanationRun(data, actor.userId, runId) };
    } catch { return { ok: false, code: signal?.aborted ? "cancelled" : "unavailable" }; }
  }
  async function command(name: string, runId: string, signal?: AbortSignal): Promise<ExplanationRunResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    const parsed = id.safeParse(runId);
    if (!parsed.success) return { ok: false, code: "invalid" };
    return request(name, { p_run_id: parsed.data }, parsed.data, signal);
  }
  return {
    async begin(input: unknown, signal?: AbortSignal): Promise<ExplanationRunResponse> {
      if (!allowed) return { ok: false, code: "forbidden" };
      const parsed = startExplanationRunSchema.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const result = await request("begin_explanation_run", { p_request: parsed.data }, parsed.data.runId, signal);
      if (result.ok && (result.run.binding_id !== parsed.data.bindingId || result.run.video_id !== parsed.data.videoId
        || result.run.source_run_id !== parsed.data.sourceRunId || result.run.page_offset !== parsed.data.offset
        || result.run.target_language !== parsed.data.targetLanguage || result.run.status !== "cleared"
          && (result.run.question !== parsed.data.question || JSON.stringify(result.run.selection) !== JSON.stringify(parsed.data.selection))))
        return { ok: false, code: "unavailable" };
      return result;
    },
    async find(input: unknown, signal?: AbortSignal): Promise<{ ok: true; runId: string | null } | Exclude<ExplanationRunResponse, { ok: true }>> {
      if (!allowed) return { ok: false, code: "forbidden" };
      const parsed = findSchema.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      if (signal?.aborted) return { ok: false, code: "cancelled" };
      try {
        const query = client.rpc("find_explanation_run", { p_request: parsed.data });
        const { data, error } = await (signal ? query.abortSignal(signal) : query);
        if (signal?.aborted) return { ok: false, code: "cancelled" };
        if (error) return explanationRunFailure(error);
        return { ok: true, runId: z.strictObject({ run_id: z.uuid().nullable() }).parse(data).run_id };
      } catch { return { ok: false, code: signal?.aborted ? "cancelled" : "unavailable" }; }
    },
    read: (runId: string, signal?: AbortSignal) => command("read_explanation_run", runId, signal),
    cancel: (runId: string, signal?: AbortSignal) => command("cancel_explanation_run", runId, signal),
  };
}
