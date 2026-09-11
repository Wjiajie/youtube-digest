import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createTranscriptTranslator } from "./transcript-translator";
import { parseTranslationRun, type TranslationRun } from "./translation-run";
import { translationRunFailure, type TranslationRunResponse } from "./translation-run-access";

type TranslationResult = Awaited<ReturnType<ReturnType<typeof createTranscriptTranslator>["run"]>>;
type Claim = { ok: true; acquired: boolean; run: TranslationRun; observedAt: string } | Exclude<TranslationRunResponse, { ok: true }>;
const claimSchema = z.strictObject({ acquired: z.boolean(), run: z.unknown(), observed_at: z.iso.datetime({ offset: true }) });
const keys = z.strictObject({ runId: z.uuid(), leaseId: z.uuid() });

/** Internal service-role adapter, not a public authorization endpoint or provider dispatcher. */
export function createTranslationRunWorker(client: SupabaseClient, ownerId: string) {
  return {
    async claim(input: { runId: string; leaseId: string; skill: NonNullable<TranslationRun["skill"]>; model: string }): Promise<Claim> {
      if (!z.uuid().safeParse(ownerId).success || !keys.safeParse({ runId: input.runId, leaseId: input.leaseId }).success)
        return { ok: false, code: "invalid" };
      try {
        const { data, error } = await client.rpc("claim_translation_run", { p_owner_id: ownerId, p_run_id: input.runId,
          p_lease_id: input.leaseId, p_skill: input.skill, p_model: input.model });
        if (error) return translationRunFailure(error);
        const receipt = claimSchema.parse(data), run = parseTranslationRun(receipt.run, ownerId, input.runId);
        if (Date.parse(receipt.observed_at) < Date.parse(run.created_at)
          || receipt.acquired && (run.status !== "running" || !run.input_page || run.skill?.sha256 !== input.skill.sha256
            || run.model !== input.model || Date.parse(receipt.observed_at) >= Date.parse(run.content_expires_at)
            || Date.parse(receipt.observed_at) >= Date.parse(run.expires_at))) throw new Error("Invalid translation claim");
        return { ok: true, acquired: receipt.acquired, run, observedAt: receipt.observed_at };
      } catch { return { ok: false, code: "unavailable" }; }
    },
    async finish(input: { runId: string; leaseId: string; result: TranslationResult }): Promise<TranslationRunResponse> {
      if (!z.uuid().safeParse(ownerId).success || !keys.safeParse({ runId: input.runId, leaseId: input.leaseId }).success)
        return { ok: false, code: "invalid" };
      const { result } = input;
      if (result.status === "translated" && (result.generationId !== input.runId || result.source.ownerId !== ownerId))
        return { ok: false, code: "invalid" };
      // Persist only translations and usage. Original captions and authoritative Skill/model
      // already belong to the database's frozen input, not the worker's completion payload.
      const completion = { status: result.status, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage,
        ...(result.status === "translated" ? { segments: result.segments.map(({ segmentIndex, translation }) => ({ segmentIndex, translation })) } : {}) };
      try {
        const { data, error } = await client.rpc("finish_translation_run", { p_owner_id: ownerId, p_run_id: input.runId,
          p_lease_id: input.leaseId, p_result: completion });
        return error ? translationRunFailure(error) : { ok: true, run: parseTranslationRun(data, ownerId, input.runId) };
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
