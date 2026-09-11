import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { createTranslationRunAccess, type TranslationRunResponse } from "./translation-run-access";
import type { createTranslationRunWorker } from "./translation-run-worker";
import { createTranscriptTranslator } from "./transcript-translator";

/** Explicit execution. Recovery only reads persistence; it never recreates a model request. */
export function createCloudTranslationRunner(dependencies: { client: SupabaseClient; actor: Actor;
  worker: ReturnType<typeof createTranslationRunWorker>; model: Exclude<LanguageModel, string> }) {
  const actor = { ...dependencies.actor }, access = createTranslationRunAccess(dependencies.client, actor);
  return { read: access.read, cancel: access.cancel, async run(input: unknown, signal: AbortSignal): Promise<TranslationRunResponse> {
    if (!(signal instanceof AbortSignal)) return { ok: false, code: "invalid" };
    if (signal.aborted) return { ok: false, code: "cancelled" };
    const started = await access.begin(input);
    if (!started.ok || started.run.status !== "queued") return started;
    if (signal.aborted) return access.cancel(started.run.id);
    try {
      const instructions = await readFile(new URL("./skills/translate-transcript/v1/SKILL.md", import.meta.url), "utf8");
      const skill = { name: "blueprint-translate-transcript" as const, version: "1.0.0" as const, instructions,
        sha256: createHash("sha256").update(instructions).digest("hex") };
      if (signal.aborted) return access.cancel(started.run.id);
      const leaseId = randomUUID(), sourceReadStartedAt = performance.now();
      const claim = await dependencies.worker.claim({ runId: started.run.id, leaseId, skill, model: dependencies.model.modelId });
      if (!claim.ok) return claim;
      if (!claim.acquired) return { ok: true, run: claim.run };
      const current = claim.run;
      if (!current.input_page || current.source_run_id !== started.run.source_run_id || current.binding_id !== started.run.binding_id
        || current.video_id !== started.run.video_id || current.page_offset !== started.run.page_offset) return { ok: false, code: "unavailable" };
      const invalidation = new AbortController(), observation = new AbortController(), expiry = new AbortController();
      const deadline = sourceReadStartedAt + Date.parse(current.expires_at) - Date.parse(claim.observedAt);
      const remaining = deadline - performance.now();
      // SQL caps the lease at source expiry. When those instants coincide, the
      // translator owns the source deadline and must retain its `expired` outcome.
      const leaseEndsFirst = Date.parse(current.expires_at) < Date.parse(current.content_expires_at);
      if (leaseEndsFirst && remaining <= 0) expiry.abort();
      const expiryTimer = leaseEndsFirst && remaining > 0 ? setTimeout(() => expiry.abort(), Math.min(remaining, 2_147_483_647)) : undefined;
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
        const result = await createTranscriptTranslator({ model: dependencies.model }).run({ generationId: current.id, ownerId: actor.userId,
          targetLanguage: current.target_language, request: { bindingId: current.binding_id, videoId: current.video_id, sourceRunId: current.source_run_id, offset: current.page_offset },
          transcript: { ...current.input_page, observedAt: claim.observedAt }, sourceReadStartedAt, expectedSkillSha256: skill.sha256,
          signal: AbortSignal.any([signal, invalidation.signal, expiry.signal]) });
        const completion = observationFailed ? { status: "unavailable" as const, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage }
          : !signal.aborted && expiry.signal.aborted ? { status: "timed_out" as const, providerMayHaveRun: result.providerMayHaveRun, usage: result.usage } : result;
        const payload = { runId: current.id, leaseId, result: completion };
        const persisted = await dependencies.worker.finish(payload);
        // An acknowledgement may be lost after the database commit. Retry this exact
        // receipt once, never the model or claim; SQL verifies completion identity.
        return !persisted.ok && persisted.code === "unavailable" ? await dependencies.worker.finish(payload) : persisted;
      } finally {
        stopped = true; clearTimeout(timer); clearTimeout(expiryTimer); observation.abort();
      }
    } catch { return { ok: false, code: "unavailable" }; }
  } };
}
