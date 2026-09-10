import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import { blueprintSnapshotSchema } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planningFailure } from "./planning-access";

const approvalSchema = z.strictObject({
  runId: z.uuid(), ownerId: z.uuid(), sourceCurrent: z.boolean(),
  proposal: z.strictObject({ id: z.uuid(), baseVersion: z.int().nonnegative(), status: z.enum(["pending", "applied", "rejected"]),
    draft: blueprintSnapshotSchema, appliedVersion: z.int().positive().nullable() }).nullable(),
}).superRefine((record, context) => {
  const proposal = record.proposal;
  if (proposal && (proposal.draft.version !== proposal.baseVersion || proposal.draft.schemaVersion !== 2
    || ((proposal.status === "applied") !== (proposal.appliedVersion !== null))))
    context.addIssue({ code: "custom", message: "Invalid planning approval receipt" });
});
export type PlanningApprovalRecord = z.infer<typeof approvalSchema>;
export type PlanningApprovalResponse = { ok: true; value: PlanningApprovalRecord }
  | { ok: false; code: "unauthenticated" | "forbidden" | "invalid" | "not_found" | "version_conflict" | "unavailable" };

/** Uses the user's JWT only. Database owns the immutable run/proposal relationship. */
export function createPlanningApprovalAccess(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity };
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  const failed = (error: { code?: string; message?: string }): PlanningApprovalResponse => {
    const mapped = planningFailure(error);
    return ["forbidden", "invalid", "not_found", "version_conflict"].includes(mapped.code)
      ? { ok: false, code: mapped.code as "forbidden" | "invalid" | "not_found" | "version_conflict" }
      : { ok: false, code: "unavailable" };
  };
  async function command(name: string, runId: string): Promise<PlanningApprovalResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    if (!z.uuid().safeParse(runId).success) return { ok: false, code: "invalid" };
    try {
      const { data, error } = await client.rpc(name, { p_run_id: runId });
      if (error) return failed(error);
      const record = approvalSchema.parse(data);
      if (record.ownerId !== actor.userId || record.runId !== runId) return { ok: false, code: "unavailable" };
      return { ok: true, value: record };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  const read = (runId: string) => command("read_path_planning_proposal", runId);
  return {
    read,
    prepare: (runId: string) => command("prepare_path_planning_proposal", runId),
    reject: (runId: string) => command("reject_path_planning_proposal", runId),
    async apply(runId: string, proposalId: string, expectedVersion: number): Promise<PlanningApprovalResponse> {
      if (!allowed) return { ok: false, code: "forbidden" };
      if (!z.uuid().safeParse(proposalId).success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
        return { ok: false, code: "invalid" };
      const state = await read(runId);
      if (!state.ok) return state;
      if (state.value.proposal?.id !== proposalId || state.value.proposal.baseVersion !== expectedVersion)
        return { ok: false, code: "version_conflict" };
      try {
        // One stable confirmation identity per immutable proposal, including uncertain retries.
        const { error } = await client.rpc("apply_blueprint_proposal", { proposal_id: proposalId, expected_version: expectedVersion, mutation_id: proposalId });
        if (error) return failed(error);
        return read(runId);
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
