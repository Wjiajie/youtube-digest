"use server";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createResourceWorkspace } from "@/lib/agent/resource-workspace";
import type { ResourceRunView, ResourceUiResult } from "./resources/resource-view";

async function access(accountId: string, id: string, operation: "read" | "cancel"): Promise<ResourceUiResult<ResourceRunView>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== accountId || identity.value.actor.client !== "web") return { ok: false, code: "forbidden" };
    return await createResourceWorkspace(identity.value.client, identity.value.actor)[operation](id);
  } catch { return { ok: false, code: "unavailable" }; }
}
export async function readResourceRunAction(accountId: string, id: string) { return access(accountId, id, "read"); }
export async function cancelResourceRunAction(accountId: string, id: string) { return access(accountId, id, "cancel"); }
