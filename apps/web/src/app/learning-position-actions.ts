"use server";

import type { ApplicationResult, LearningPosition, LearningPositionWorkspace } from "@blueprint/domain";
import { recordLearningPosition, readLearningPositionWorkspace } from "@/lib/learning-positions";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function recordLearningPositionAction(expectedAccountId: string, input: unknown): Promise<ApplicationResult<LearningPosition>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await recordLearningPosition(context.value.client, context.value.actor, input);
  } catch { return { ok: false, code: "unavailable" }; }
}

export async function readLearningPositionWorkspaceAction(expectedAccountId: string, resourceBindingId?: unknown): Promise<ApplicationResult<LearningPositionWorkspace>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await readLearningPositionWorkspace(context.value.client, context.value.actor, resourceBindingId);
  } catch { return { ok: false, code: "unavailable" }; }
}
