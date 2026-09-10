"use server";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createResourceAdoptionWorkspace } from "@/lib/agent/resource-adoption-workspace";
import type { ResourceUiResult } from "./resources/resource-view";
import type { AdoptionView } from "./resources/adoption-view";
async function action(accountId: string, id: string, kind: "read" | "cancel" | "reject" | "apply", proposalId?: string, version?: number): Promise<ResourceUiResult<AdoptionView>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== accountId || identity.value.actor.client !== "web") return { ok: false, code: "forbidden" };
    const workspace = createResourceAdoptionWorkspace(identity.value.client, identity.value.actor);
    return kind === "apply" ? workspace.apply(id, proposalId ?? "", version ?? -1) : workspace[kind](id);
  } catch { return { ok: false, code: "unavailable" }; }
}
export async function readResourceAdoptionAction(accountId: string, id: string) { return action(accountId, id, "read"); }
export async function cancelResourceAdoptionAction(accountId: string, id: string) { return action(accountId, id, "cancel"); }
export async function rejectResourceAdoptionAction(accountId: string, id: string) { return action(accountId, id, "reject"); }
export async function applyResourceAdoptionAction(accountId: string, id: string, proposalId: string, version: number) { return action(accountId, id, "apply", proposalId, version); }
