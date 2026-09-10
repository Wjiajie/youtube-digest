"use server";

import type { ApplicationResult, LearningNote, LearningNoteWorkspace } from "@blueprint/domain";
import { recordLearningNote, readLearningNoteWorkspace } from "@/lib/learning-notes";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function recordLearningNoteAction(expectedAccountId: string, input: unknown): Promise<ApplicationResult<LearningNote>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await recordLearningNote(context.value.client, context.value.actor, input);
  } catch { return { ok: false, code: "unavailable" }; }
}

export async function readLearningNoteWorkspaceAction(expectedAccountId: string): Promise<ApplicationResult<LearningNoteWorkspace>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await readLearningNoteWorkspace(context.value.client, context.value.actor);
  } catch { return { ok: false, code: "unavailable" }; }
}
