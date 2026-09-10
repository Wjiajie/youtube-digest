"use server";

import { revalidatePath } from "next/cache";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createPlanningApprovalAccess, type PlanningApprovalResponse } from "@/lib/agent/planning-approval";

async function access(expectedAccountId: string, operation: (api: ReturnType<typeof createPlanningApprovalAccess>) => Promise<PlanningApprovalResponse>): Promise<PlanningApprovalResponse> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await operation(createPlanningApprovalAccess(identity.value.client, identity.value.actor));
  } catch { return { ok: false, code: "unavailable" }; }
}
export async function readPlanningApprovalAction(accountId: string, runId: string) {
  return access(accountId, api => api.read(runId));
}
export async function preparePlanningApprovalAction(accountId: string, runId: string) {
  return access(accountId, api => api.prepare(runId));
}
export async function rejectPlanningApprovalAction(accountId: string, runId: string) {
  return access(accountId, api => api.reject(runId));
}
export async function applyPlanningApprovalAction(accountId: string, runId: string, proposalId: string, baseVersion: number) {
  const response = await access(accountId, api => api.apply(runId, proposalId, baseVersion));
  if (response.ok && response.value.proposal?.status === "applied") {
    revalidatePath("/"); revalidatePath("/blueprint/edit"); revalidatePath("/paths", "layout");
  }
  return response;
}
