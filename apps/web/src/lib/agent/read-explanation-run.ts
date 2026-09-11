import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { readLearningTranscript } from "../learning-transcript";
import { createExplanationRunAccess } from "./explanation-run-access";
import type { ExplanationRun } from "./explanation-run";

const project = (run: ExplanationRun, observedAt: string | null) => ({ ok: true as const, run: {
  runId: run.id, accountId: run.owner_id, status: run.status,
  context: { bindingId: run.binding_id, videoId: run.video_id, sourceRunId: run.source_run_id, offset: run.page_offset },
  targetLanguage: run.target_language, contentExpiresAt: run.content_expires_at, observedAt,
  selection: run.selection, question: run.question, result: run.result,
} });

function sameRequest(before: ExplanationRun, after: ExplanationRun) {
  const identity = (run: ExplanationRun) => [run.id, run.owner_id, run.blueprint_id, run.node_id, run.binding_id,
    run.video_id, run.source_run_id, run.page_offset, run.target_language, run.request_fingerprint,
    run.created_at, run.source_started_at, run.content_expires_at, run.retention_policy_ref];
  return JSON.stringify(identity(before)) === JSON.stringify(identity(after)) && (after.status === "cleared"
    || before.question === after.question && JSON.stringify(before.selection) === JSON.stringify(after.selection)
      && JSON.stringify(before.input_page) === JSON.stringify(after.input_page));
}

/** Public result only. Even an unfinished run's question requires a live source. */
export async function readExplanationRun(client: SupabaseClient, actor: Actor, runId: string, signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    const access = createExplanationRunAccess(client, actor);
    const response = await access.read(runId, signal);
    if (!response.ok) return response;
    const run = response.run;
    if (run.status === "cleared") return project(run, null);
    const sourceReadStartedAt = performance.now();
    const source = await readLearningTranscript(client, actor, {
      bindingId: run.binding_id, videoId: run.video_id, sourceRunId: run.source_run_id, offset: run.page_offset,
    }, signal);
    if (!source.ok || source.value.status !== "ready") return { ok: false as const, code: "unavailable" as const };
    const page = source.value, frozen = run.input_page;
    if (!frozen || page.context.nodeId !== run.node_id || page.sourceBlueprintVersion !== frozen.sourceBlueprintVersion
      || page.language !== frozen.language || page.totalSegments !== frozen.totalSegments
      || Date.parse(page.sourceCreatedAt) !== Date.parse(frozen.sourceCreatedAt)
      || Date.parse(page.contentExpiresAt) !== Date.parse(run.content_expires_at)
      || JSON.stringify(page.segments) !== JSON.stringify(frozen.segments)) return { ok: false as const, code: "unavailable" as const };
    // The entire network round trip consumes the database-observed remaining lifetime.
    const deadline = sourceReadStartedAt + Date.parse(page.contentExpiresAt) - Date.parse(page.observedAt);
    if (!Number.isFinite(deadline) || performance.now() >= deadline) return { ok: false as const, code: "unavailable" as const };
    signal.throwIfAborted();
    // Recheck after the source round trip: clearing/cancelling must not revive a stale answer.
    const latest = await access.read(runId, signal);
    signal.throwIfAborted();
    if (!latest.ok) return latest;
    if (!sameRequest(run, latest.run)) return { ok: false as const, code: "unavailable" as const };
    if (latest.run.status !== "cleared" && performance.now() >= deadline) return { ok: false as const, code: "unavailable" as const };
    return project(latest.run, latest.run.status === "cleared" ? null : page.observedAt);
  } catch { return { ok: false as const, code: "unavailable" as const }; }
}
