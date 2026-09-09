"use server";

import type { ApplicationResult, NodeStatusRecord, NodeStatusWorkspace } from "@blueprint/domain";
import { confirmNodeStatus, readNodeStatusWorkspace } from "@/lib/node-status";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function confirmNodeStatusAction(expectedAccountId: string, input: unknown): Promise<ApplicationResult<NodeStatusRecord>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await confirmNodeStatus(identity.value.client, identity.value.actor, input);
  } catch { return { ok: false, code: "unavailable" }; }
}

export async function readNodeStatusWorkspaceAction(expectedAccountId: string): Promise<ApplicationResult<NodeStatusWorkspace>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await readNodeStatusWorkspace(identity.value.client, identity.value.actor);
  } catch { return { ok: false, code: "unavailable" }; }
}
