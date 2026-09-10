import type { SupabaseClient } from "@supabase/supabase-js";
import { learningTranscriptRequestSchema, parseLearningTranscript, type Actor, type ApplicationResult, type LearningTranscript } from "@blueprint/domain";

/** Read projection only. Uses the verified caller's client, never execution/admin credentials. */
export async function readLearningTranscript(client: SupabaseClient, actor: Actor, input: unknown): Promise<ApplicationResult<LearningTranscript>> {
  const parsed = learningTranscriptRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const request = parsed.data;
  try {
    const { data, error } = await client.rpc("read_learning_transcript", { p_resource_binding_id: request.bindingId,
      p_video_id: request.videoId, p_source_run_id: request.sourceRunId, p_offset: request.offset });
    if (error) {
      const code = { "42501": "forbidden", "P0002": "not_found", "22023": "invalid" }[error.code] as "forbidden" | "not_found" | "invalid" | undefined;
      return { ok: false, code: code ?? "unavailable" };
    }
    return { ok: true, value: parseLearningTranscript(data, actor.userId, request) };
  } catch { return { ok: false, code: "unavailable" }; }
}
