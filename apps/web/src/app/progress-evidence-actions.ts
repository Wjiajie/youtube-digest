"use server";

import type { ApplicationResult, ProgressEvidence } from "@blueprint/domain";
import { readEvidenceWorkspace, recordProgressEvidence, type EvidenceWorkspace } from "@/lib/progress-evidence";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function recordProgressEvidenceAction(expectedAccountId: string, input: unknown): Promise<ApplicationResult<ProgressEvidence>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await recordProgressEvidence(context.value.client, context.value.actor, input);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function readEvidenceWorkspaceAction(expectedAccountId: string): Promise<ApplicationResult<EvidenceWorkspace>> {
  try {
    const context = await resolveRequestActor();
    if (!context.ok) return context;
    if (context.value.actor.userId !== expectedAccountId) return { ok: false, code: "forbidden" };
    return await readEvidenceWorkspace(context.value.client, context.value.actor);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
