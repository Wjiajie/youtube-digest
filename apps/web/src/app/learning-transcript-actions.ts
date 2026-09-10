"use server";
import type { ApplicationResult, LearningTranscript, LearningTranscriptRequest } from "@blueprint/domain";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readLearningTranscript } from "@/lib/learning-transcript";

export async function readLearningTranscriptAction(accountId: string, input: LearningTranscriptRequest): Promise<ApplicationResult<LearningTranscript>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== accountId) return { ok: false, code: "forbidden" };
    return readLearningTranscript(identity.value.client, identity.value.actor, input);
  } catch { return { ok: false, code: "unavailable" }; }
}
