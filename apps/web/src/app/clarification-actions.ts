"use server";
import { z } from "zod";
import { goalBriefContentSchema } from "@blueprint/domain";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createClarificationWorkspace } from "@/lib/agent/clarification-workspace";
import type { ClarificationUiResult } from "./clarification/clarification-view";

async function withWorkspace<T>(expectedAccountId: string,
  operation: (workspace: ReturnType<typeof createClarificationWorkspace>) => Promise<ClarificationUiResult<T>>): Promise<ClarificationUiResult<T>> {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return identity;
    if (identity.value.actor.userId !== expectedAccountId || identity.value.actor.client !== "web") return { ok: false, code: "forbidden" };
    return await operation(createClarificationWorkspace(identity.value.client, identity.value.actor));
  } catch { return { ok: false, code: "unavailable" }; }
}

export async function startClarificationAction(accountId: string, input: unknown) {
  return withWorkspace(accountId, workspace => workspace.start(input));
}
export async function readClarificationAction(accountId: string, sessionId: string, offset = 0) {
  return withWorkspace(accountId, workspace => workspace.read(sessionId, offset));
}
export async function readClarificationTurnAction(accountId: string, sessionId: string, turnId: string) {
  return withWorkspace(accountId, workspace => workspace.readTurn(turnId, sessionId));
}
export async function cancelClarificationTurnAction(accountId: string, sessionId: string, turnId: string) {
  return withWorkspace(accountId, workspace => workspace.cancelTurn(turnId, sessionId));
}
const revision = z.int().min(1).max(2147483646);
const editSchema = z.strictObject({ expectedRevision: revision, content: goalBriefContentSchema, clientMutationId: z.uuid() });
const saveSchema = z.strictObject({ expectedRevision: revision, confirm: z.boolean(), clientMutationId: z.uuid() });
export async function editClarificationAction(accountId: string, sessionId: string, input: unknown) {
  return withWorkspace(accountId, async workspace => {
    const parsed = editSchema.safeParse(input);
    return parsed.success ? workspace.edit({ ...parsed.data, sessionId }) : { ok: false, code: "invalid" };
  });
}
export async function saveClarificationAction(accountId: string, sessionId: string, input: unknown) {
  return withWorkspace(accountId, async workspace => {
    const parsed = saveSchema.safeParse(input);
    return parsed.success ? workspace.save({ ...parsed.data, sessionId }) : { ok: false, code: "invalid" };
  });
}
