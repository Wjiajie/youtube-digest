import type { SupabaseClient } from "@supabase/supabase-js";
import { learningPositionBindingFilterSchema, learningPositionSchema, parseLearningPositionWorkspace, recordLearningPositionSchema,
  type Actor, type ApplicationResult, type LearningPosition, type LearningPositionWorkspace } from "@blueprint/domain";

export async function recordLearningPosition(client: SupabaseClient, actor: Actor, input: unknown): Promise<ApplicationResult<LearningPosition>> {
  const parsed = recordLearningPositionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const command = parsed.data;
  const { data, error } = await client.rpc("record_learning_position", {
    p_node_id: command.nodeId, p_resource_binding_id: command.resourceBindingId, p_expected_version: command.expectedVersion,
    p_expected_position_version: command.expectedPositionVersion, p_position_seconds: command.positionSeconds, p_client_mutation_id: command.clientMutationId,
  });
  if (error) return databaseFailure(error);
  const position = fromRow(data, actor.userId);
  if (position.clientMutationId !== command.clientMutationId || position.context.nodeId !== command.nodeId
    || position.resource.bindingId !== command.resourceBindingId || position.context.blueprintVersion !== command.expectedVersion
    || position.expectedPositionVersion !== command.expectedPositionVersion || position.positionSeconds !== command.positionSeconds) throw new Error("Incoherent position receipt");
  return { ok: true, value: position };
}

export async function readLearningPositionWorkspace(client: SupabaseClient, actor: Actor, resourceBindingId?: unknown): Promise<ApplicationResult<LearningPositionWorkspace>> {
  const parsed = learningPositionBindingFilterSchema.safeParse(resourceBindingId);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const bindingId = parsed.data;
  const { data, error } = await client.rpc("read_learning_position_workspace", { p_owner_id: actor.userId,
    ...(bindingId ? { p_resource_binding_id: bindingId } : {}) });
  if (error) return databaseFailure(error);
  if (!data) return { ok: false, code: "not_found" };
  if (!Array.isArray(data.records) || data.records.length > 50) throw new Error("Invalid position history");
  const workspace = parseLearningPositionWorkspace({ blueprint: data.blueprint,
    records: data.records.map((row: Record<string, unknown>) => fromRow(row, actor.userId)) });
  if (bindingId && workspace.records.some(record => record.resource.bindingId !== bindingId)) throw new Error("Invalid filtered position source");
  return { ok: true, value: workspace };
}

function fromRow(row: Record<string, unknown>, ownerId: string): LearningPosition {
  if (!row || row.owner_id !== ownerId) throw new Error("Invalid position owner");
  return learningPositionSchema.parse({
    id: row.id, clientMutationId: row.client_mutation_id,
    context: { blueprintId: row.blueprint_id, blueprintVersion: row.blueprint_version, goalId: row.goal_id, goalTitle: row.goal_title,
      stageId: row.stage_id, stageTitle: row.stage_title, nodeId: row.node_id, nodeTitle: row.node_title, nodeType: row.node_type },
    resource: { bindingId: row.resource_binding_id, videoId: row.video_id, url: row.resource_url },
    positionSeconds: row.position_seconds, expectedPositionVersion: row.expected_position_version, positionVersion: row.position_version, createdAt: row.created_at,
  });
}

function databaseFailure(error: { code: string }): Extract<ApplicationResult<never>, { ok: false }> {
  switch (error.code) {
    case "P0002": return { ok: false, code: "not_found" };
    case "40001": return { ok: false, code: "version_conflict" };
    case "42501": return { ok: false, code: "forbidden" };
    case "22023": case "23514": return { ok: false, code: "invalid" };
    default: throw error;
  }
}
