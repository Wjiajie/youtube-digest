import type { SupabaseClient } from "@supabase/supabase-js";
import {
  progressEvidenceSchema, recordProgressEvidenceSchema,
  type Actor, type ApplicationResult, type BlueprintSnapshot, type ProgressEvidence,
} from "@blueprint/domain";
import { blueprintApplication } from "./application";

export type EvidenceWorkspace = { blueprint: BlueprintSnapshot; records: ApplicationResult<ProgressEvidence[]> };

export async function readEvidenceWorkspace(client: SupabaseClient, actor: Actor): Promise<ApplicationResult<EvidenceWorkspace>> {
  const [blueprint, records] = await Promise.all([
    blueprintApplication(client).getMainBlueprint(actor).catch(() => ({ ok: false as const, code: "unavailable" as const })),
    readRecentProgressEvidence(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const })),
  ]);
  return blueprint.ok ? { ok: true, value: { blueprint: blueprint.value, records } } : blueprint;
}

export async function recordProgressEvidence(
  client: SupabaseClient, actor: Actor, input: unknown,
): Promise<ApplicationResult<ProgressEvidence>> {
  const parsed = recordProgressEvidenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const value = parsed.data;
  const { data, error } = await client.rpc("record_progress_evidence", {
    p_node_id: value.nodeId, p_expected_version: value.expectedVersion,
    p_evidence_text: value.text, p_artifact_url: value.artifactUrl ?? null,
    p_client_mutation_id: value.clientMutationId,
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

// Explicitly a recent feed, not a complete history/export API.
export async function readRecentProgressEvidence(
  client: SupabaseClient, actor: Actor,
): Promise<ApplicationResult<ProgressEvidence[]>> {
  const { data, error } = await client.from("progress_evidence")
    .select("id,owner_id,client_mutation_id,blueprint_id,blueprint_version,goal_id,goal_title,stage_id,stage_title,node_id,node_title,node_type,evidence_text,artifact_url,created_at")
    .eq("owner_id", actor.userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50);
  if (error) throw error;
  return { ok: true, value: (data ?? []).map((row) => fromRow(row, actor.userId)) };
}

function fromRow(row: Record<string, unknown>, ownerId: string): ProgressEvidence {
  if (!row || row.owner_id !== ownerId) throw new Error("Invalid evidence owner");
  return progressEvidenceSchema.parse({
    id: row.id, clientMutationId: row.client_mutation_id,
    context: {
      blueprintId: row.blueprint_id, blueprintVersion: row.blueprint_version,
      goalId: row.goal_id, goalTitle: row.goal_title, stageId: row.stage_id, stageTitle: row.stage_title,
      nodeId: row.node_id, nodeTitle: row.node_title, nodeType: row.node_type,
    },
    text: row.evidence_text, artifactUrl: row.artifact_url, createdAt: row.created_at,
  });
}
