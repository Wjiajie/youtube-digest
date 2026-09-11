import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createCaptionExplainer } from "./caption-explainer";
import { explanationCompletionSchema, parseExplanationRun, type ExplanationRun } from "./explanation-run";
import { explanationRunFailure, type ExplanationRunResponse } from "./explanation-run-access";
import { explanationAnswerMatches, explanationEvidence } from "./explanation-evidence";

type ExplanationResult = Awaited<ReturnType<ReturnType<typeof createCaptionExplainer>["run"]>>;
type Claim = { ok: true; acquired: boolean; run: ExplanationRun; observedAt: string } | Exclude<ExplanationRunResponse, { ok: true }>;
const claimSchema = z.strictObject({ acquired: z.boolean(), run: z.unknown(), observed_at: z.iso.datetime({ offset: true }) });
const keys = z.strictObject({ runId: z.uuid(), leaseId: z.uuid() });
type ClaimInput = { runId: string; leaseId: string; skill: NonNullable<ExplanationRun["skill"]>; model: string };
type Receipt = { data: unknown; error: { code?: string; message?: string } | null };
export type ExplanationPersistence = {
  claim(input: ClaimInput): PromiseLike<Receipt>;
  finish(input: { runId: string; leaseId: string; result: z.infer<typeof explanationCompletionSchema> }): PromiseLike<Receipt>;
};

/** Service persistence only; not a public authorization or generation endpoint. */
export function createExplanationRunWorker(client: SupabaseClient, ownerId: string) {
  return createExplanationWorkerAdapter({
    claim: input => client.rpc("claim_explanation_run", { p_owner_id: ownerId, p_run_id: input.runId,
      p_lease_id: input.leaseId, p_skill: input.skill, p_model: input.model }),
    finish: input => client.rpc("finish_explanation_run", { p_owner_id: ownerId, p_run_id: input.runId,
      p_lease_id: input.leaseId, p_result: input.result }),
  }, ownerId);
}

export function createExplanationWorkerAdapter(persistence: ExplanationPersistence, ownerId: string) {
  return {
    async claim(input: ClaimInput): Promise<Claim> {
      if (!z.uuid().safeParse(ownerId).success || !keys.safeParse({ runId: input.runId, leaseId: input.leaseId }).success)
        return { ok: false, code: "invalid" };
      try {
        const { data, error } = await persistence.claim(input);
        if (error) return explanationRunFailure(error);
        const receipt = claimSchema.parse(data), run = parseExplanationRun(receipt.run, ownerId, input.runId);
        if (Date.parse(receipt.observed_at) < Date.parse(run.created_at)
          || receipt.acquired && (run.status !== "running" || !run.input_page || !isDeepStrictEqual(run.skill, input.skill)
            || run.model !== input.model || Date.parse(receipt.observed_at) >= Date.parse(run.content_expires_at)
            || Date.parse(receipt.observed_at) >= Date.parse(run.expires_at))) throw new Error("Invalid explanation claim");
        return { ok: true, acquired: receipt.acquired, run, observedAt: receipt.observed_at };
      } catch { return { ok: false, code: "unavailable" }; }
    },
    async finish(input: { runId: string; leaseId: string; run: ExplanationRun; result: ExplanationResult }): Promise<ExplanationRunResponse> {
      if (!z.uuid().safeParse(ownerId).success || !keys.safeParse({ runId: input.runId, leaseId: input.leaseId }).success)
        return { ok: false, code: "invalid" };
      let run: ExplanationRun, completion: z.infer<typeof explanationCompletionSchema>;
      try {
        run = parseExplanationRun(input.run, ownerId, input.runId);
        if (run.status !== "running" || !run.input_page || !run.selection || run.question === null || !run.skill) throw new Error("Invalid claim");
        const result = input.result;
        if (result.status === "explained" || result.status === "insufficient_context") {
          const evidence = explanationEvidence(run.input_page, run.selection, run.question);
          if (result.generationId !== run.id || !isDeepStrictEqual(result.source, evidence.source)
            || result.requestSha256 !== evidence.requestSha256 || !isDeepStrictEqual(result.selected, evidence.selected)
            || !isDeepStrictEqual(result.skill, { name: run.skill.name, version: run.skill.version, sha256: run.skill.sha256 })
            || !explanationAnswerMatches(result.answer, evidence)) throw new Error("Invalid explanation correspondence");
        }
        // Only the answer and consumption receipt travel back. Source, selection,
        // question and Skill belong to the immutable database claim, never the model.
        completion = explanationCompletionSchema.parse({ status: result.status, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage,
          ...(result.status === "explained" || result.status === "insufficient_context" ? { answer: result.answer } : {}) });
        if ("answer" in completion && (completion.status === "explained") !== (completion.answer.kind === "explanation")) throw new Error("Invalid outcome");
      } catch { return { ok: false, code: "invalid" }; }
      try {
        const { data, error } = await persistence.finish({ runId: input.runId, leaseId: input.leaseId, result: completion });
        if (error) return explanationRunFailure(error);
        const saved = parseExplanationRun(data, ownerId, input.runId);
        if (saved.request_fingerprint !== run.request_fingerprint || saved.source_run_id !== run.source_run_id
          || saved.binding_id !== run.binding_id || saved.node_id !== run.node_id || saved.blueprint_id !== run.blueprint_id
          || saved.video_id !== run.video_id || saved.page_offset !== run.page_offset
          || saved.content_expires_at !== run.content_expires_at || saved.created_at !== run.created_at || saved.source_started_at !== run.source_started_at
          || saved.retention_policy_ref !== run.retention_policy_ref || saved.status === "queued" || saved.status === "running"
          || saved.status !== "cleared" && (saved.question !== run.question || !isDeepStrictEqual(saved.selection, run.selection)
            || !isDeepStrictEqual(saved.input_page, run.input_page) || !isDeepStrictEqual(saved.skill, run.skill) || saved.model !== run.model)
          || saved.status === "ready" && !isDeepStrictEqual(saved.result, completion))
          throw new Error("Invalid explanation completion receipt");
        return { ok: true, run: saved };
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
