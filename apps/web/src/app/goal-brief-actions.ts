"use server";

import type { ApplicationResult, GoalBrief } from "@blueprint/domain";
import { listGoalBriefs, readGoalBrief, saveGoalBrief } from "@/lib/goal-briefs";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function saveGoalBriefAction(expectedAccountId: string, input: unknown): Promise<ApplicationResult<GoalBrief>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await saveGoalBrief(identity.value.client, identity.value.actor, input);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function readGoalBriefAction(expectedAccountId: string, id: string): Promise<ApplicationResult<GoalBrief>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await readGoalBrief(identity.value.client, identity.value.actor, id);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function listGoalBriefsAction(expectedAccountId: string, offset = 0): Promise<ApplicationResult<{ briefs: GoalBrief[]; hasMore: boolean }>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await listGoalBriefs(identity.value.client, identity.value.actor, offset);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
