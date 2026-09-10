"use server";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createPlanningRunAccess } from "@/lib/agent/planning-access";
import type { PlanningResponse } from "./planning/planning-review";

async function access(expectedAccountId: string, id: string, operation: "read" | "cancel"): Promise<PlanningResponse> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await createPlanningRunAccess(identity.value.client, identity.value.actor)[operation](id);
  } catch { return { ok: false, code: "unavailable" }; }
}
export async function readPlanningRunAction(expectedAccountId: string, id: string): Promise<PlanningResponse> {
  return access(expectedAccountId, id, "read");
}
export async function cancelPlanningRunAction(expectedAccountId: string, id: string): Promise<PlanningResponse> {
  return access(expectedAccountId, id, "cancel");
}
