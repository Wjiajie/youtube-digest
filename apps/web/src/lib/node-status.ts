import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  confirmNodeStatusSchema, nodeStatusRecordSchema, parseCurrentBlueprintSnapshot,
  type Actor, type ApplicationResult, type NodeStatusRecord, type NodeStatusWorkspace,
} from "@blueprint/domain";
import { readRecentProgressEvidence } from "./progress-evidence";

export async function confirmNodeStatus(client: SupabaseClient, actor: Actor, input: unknown): Promise<ApplicationResult<NodeStatusRecord>> {
  const parsed = confirmNodeStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const value = parsed.data;
  const { data, error } = await client.rpc("confirm_node_status", {
    p_node_id: value.nodeId, p_expected_version: value.expectedVersion,
    p_expected_status_revision: value.expectedStatusRevision, p_status: value.status,
    p_evidence_id: value.evidenceId ?? null, p_client_mutation_id: value.clientMutationId,
  });
  if (error) {
    switch (error.code) {
      case "P0002": return { ok: false, code: "not_found" };
      case "40001": return { ok: false, code: "version_conflict" };
      case "42501": return { ok: false, code: "forbidden" };
      case "22023":
      case "23514": return { ok: false, code: "invalid" };
      default: throw error;
    }
  }
  return { ok: true, value: fromRow(data, actor.userId) };
}

export async function readNodeStatusWorkspace(client: SupabaseClient, actor: Actor): Promise<ApplicationResult<NodeStatusWorkspace>> {
  const { data, error } = await client.rpc("read_node_status_workspace", { p_owner_id: actor.userId });
  if (error) throw error;
  if (data === null) return { ok: false, code: "not_found" };
  const workspace = z.object({ blueprint: z.unknown(), current: z.array(z.record(z.string(), z.unknown())),
    history: z.array(z.record(z.string(), z.unknown())) }).strict().parse(data);
  const blueprint = parseCurrentBlueprintSnapshot(workspace.blueprint);
  const current = workspace.current.map(row => fromRow(row, actor.userId));
  const history = workspace.history.map(row => fromRow(row, actor.userId));
  const evidence = await readRecentProgressEvidence(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return { ok: true, value: { blueprint, current, history, evidence } };
}

function fromRow(row: Record<string, unknown>, ownerId: string): NodeStatusRecord {
  if (!row || row.owner_id !== ownerId) throw new Error("Invalid status owner");
  return nodeStatusRecordSchema.parse({
    id: row.id, clientMutationId: row.client_mutation_id,
    context: { blueprintId: row.blueprint_id, blueprintVersion: row.blueprint_version,
      goalId: row.goal_id, goalTitle: row.goal_title, stageId: row.stage_id, stageTitle: row.stage_title,
      nodeId: row.node_id, nodeTitle: row.node_title, nodeType: row.node_type },
    estimatedMinutes: row.estimated_minutes, completionCriteria: row.completion_criteria,
    status: row.status, revision: row.revision, evidenceId: row.evidence_id, createdAt: row.created_at,
  });
}
