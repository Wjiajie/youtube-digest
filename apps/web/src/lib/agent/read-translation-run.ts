import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { readLearningTranscript } from "../learning-transcript";
import { createTranslationRunAccess } from "./translation-run-access";

/** Browser projection, not a persistence receipt. Fresh source evidence gates every ready response. */
export async function readTranslationRun(client: SupabaseClient, actor: Actor, runId: string, signal: AbortSignal) {
  const response = await createTranslationRunAccess(client, actor).read(runId, signal);
  if (!response.ok) return response;
  const run = response.run;
  const context = { bindingId: run.binding_id, videoId: run.video_id, sourceRunId: run.source_run_id, offset: run.page_offset };
  let observedAt: string | null = null;
  if (run.status === "ready") {
    const source = await readLearningTranscript(client, actor, context, signal);
    if (!source.ok || source.value.status !== "ready" || !run.input_page) return { ok: false as const, code: "unavailable" as const };
    const page = source.value, frozen = run.input_page;
    if (page.context.nodeId !== run.node_id || page.language !== frozen.language || page.totalSegments !== frozen.totalSegments
      || Date.parse(page.sourceCreatedAt) !== Date.parse(frozen.sourceCreatedAt)
      || Date.parse(page.contentExpiresAt) !== Date.parse(run.content_expires_at)
      || JSON.stringify(page.segments) !== JSON.stringify(frozen.segments)) return { ok: false as const, code: "unavailable" as const };
    observedAt = page.observedAt;
  }
  return { ok: true as const, run: { runId: run.id, accountId: run.owner_id, status: run.status, context,
    targetLanguage: run.target_language, contentExpiresAt: run.content_expires_at, observedAt, result: run.result } };
}
