import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { createExplanationRunAccess, type ExplanationRunResponse } from "./explanation-run-access";
import type { createExplanationRunWorker } from "./explanation-run-worker";
import { createCaptionExplainer } from "./caption-explainer";

/** Explicit, once-only execution. Recovery never recreates an inference request. */
export function createCloudExplanationRunner({ client, actor: identity, worker, model }: {
  client: SupabaseClient; actor: Actor; worker: ReturnType<typeof createExplanationRunWorker>; model: Exclude<LanguageModel, string>;
}) {
  const actor = { ...identity }, access = createExplanationRunAccess(client, actor);
  const budget = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  async function bounded<T extends { ok: true } | { ok: false; code: string }>(request: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    const result = await request(budget(signal));
    return !result.ok && result.code === "cancelled" && !signal?.aborted ? { ok: false as const, code: "unavailable" as const } : result;
  }
  const cancel = (runId: string, signal?: AbortSignal) => bounded(bound => access.cancel(runId, bound), signal);
  return {
    read: (runId: string, signal?: AbortSignal) => bounded(bound => access.read(runId, bound), signal),
    find: (input: unknown, signal?: AbortSignal) => bounded(bound => access.find(input, bound), signal),
    cancel,
    async run(input: unknown, signal: AbortSignal): Promise<ExplanationRunResponse> {
      if (!(signal instanceof AbortSignal)) return { ok: false, code: "invalid" };
      if (signal.aborted) return { ok: false, code: "cancelled" };
      // Let the finite reservation finish even if the caller disconnects, so a
      // confirmed queued reservation can be cancelled/refunded. Unknown is not retried.
      const started = await bounded(bound => access.begin(input, bound));
      if (!started.ok || started.run.status !== "queued") return started;
      if (signal.aborted) return cancel(started.run.id);
      try {
        const instructions = await readFile(new URL("./skills/explain-selection/v1/SKILL.md", import.meta.url),
          { encoding: "utf8", signal: budget(signal) });
        const skill = { name: "blueprint-explain-selection" as const, version: "1.0.0" as const, instructions,
          sha256: createHash("sha256").update(instructions).digest("hex") };
        if (signal.aborted) return cancel(started.run.id);
        const leaseId = randomUUID(), sourceReadStartedAt = performance.now();
        const claim = await worker.claim({ runId: started.run.id, leaseId, skill, model: model.modelId });
        if (!claim.ok) return claim;
        const current = claim.run;
        if (current.request_fingerprint !== started.run.request_fingerprint || current.source_run_id !== started.run.source_run_id
          || current.binding_id !== started.run.binding_id || current.video_id !== started.run.video_id || current.page_offset !== started.run.page_offset
          || current.node_id !== started.run.node_id || current.blueprint_id !== started.run.blueprint_id
          || current.created_at !== started.run.created_at || current.source_started_at !== started.run.source_started_at
          || current.content_expires_at !== started.run.content_expires_at || current.retention_policy_ref !== started.run.retention_policy_ref
          || current.status !== "cleared" && (!isDeepStrictEqual(current.input_page, started.run.input_page)
            || !isDeepStrictEqual(current.selection, started.run.selection) || current.question !== started.run.question))
          return { ok: false, code: "unavailable" };
        if (!claim.acquired) return { ok: true, run: current };
        if (!current.input_page || !current.selection || current.question === null) return { ok: false, code: "unavailable" };
        const invalidation = new AbortController(), observation = new AbortController(), leaseExpiry = new AbortController();
        const leaseRemaining = sourceReadStartedAt + Date.parse(current.expires_at) - Date.parse(claim.observedAt) - performance.now();
        // When both deadlines coincide, the engine retains source-expiry semantics.
        const leaseEndsFirst = Date.parse(current.expires_at) < Date.parse(current.content_expires_at);
        if (leaseEndsFirst && leaseRemaining <= 0) leaseExpiry.abort();
        const leaseTimer = leaseEndsFirst && leaseRemaining > 0
          ? setTimeout(() => leaseExpiry.abort(), Math.min(leaseRemaining, 2_147_483_647)) : undefined;
        let stopped = false, observationFailed = false, timer: ReturnType<typeof setTimeout> | undefined;
        const observe = async () => {
          const receipt = await access.read(current.id, AbortSignal.any([observation.signal, AbortSignal.timeout(5000)]));
          if (stopped) return;
          if (!receipt.ok || receipt.run.status !== "running") {
            observationFailed = !receipt.ok;
            invalidation.abort();
          } else timer = setTimeout(() => { void observe(); }, 1000);
        };
        timer = setTimeout(() => { void observe(); }, 1000);
        try {
          const result = await createCaptionExplainer({ model }).run({ generationId: current.id, ownerId: actor.userId,
            request: { bindingId: current.binding_id, videoId: current.video_id, sourceRunId: current.source_run_id, offset: current.page_offset },
            transcript: { ...current.input_page, observedAt: claim.observedAt }, selection: current.selection, question: current.question,
            sourceReadStartedAt, expectedSkillSha256: skill.sha256, signal: AbortSignal.any([signal, invalidation.signal, leaseExpiry.signal]) });
          const completion = { runId: current.id, leaseId, run: current,
            result: observationFailed ? { status: "unavailable" as const, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage }
              : !signal.aborted && leaseExpiry.signal.aborted ? { status: "timed_out" as const, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage } : result };
          const saved = await worker.finish(completion);
          // An acknowledgement may disappear after commit. Repeat only this exact
          // completion, never claim or inference; the database checks its digest.
          return !saved.ok && saved.code === "unavailable" ? worker.finish(completion) : saved;
        } finally { stopped = true; clearTimeout(timer); clearTimeout(leaseTimer); observation.abort(); }
      } catch {
        return signal.aborted ? cancel(started.run.id) : { ok: false, code: "unavailable" };
      }
    },
  };
}
