import type { SupabaseClient } from "@supabase/supabase-js";
import { learningNoteSchema, parseBlueprintSnapshot, recordLearningNoteSchema,
  type Actor, type ApplicationResult, type LearningNote, type LearningNoteWorkspace } from "@blueprint/domain";

export async function recordLearningNote(client: SupabaseClient, actor: Actor, input: unknown): Promise<ApplicationResult<LearningNote>> {
  const parsed = recordLearningNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const command = parsed.data;
  const { data, error } = await client.rpc("record_learning_note", {
    p_node_id: command.nodeId, p_resource_binding_id: command.resourceBindingId, p_expected_version: command.expectedVersion,
    p_note_text: command.text, p_position_seconds: command.positionSeconds, p_client_mutation_id: command.clientMutationId,
  });
  if (error) return databaseFailure(error);
  const note = fromRow(data, actor.userId);
  if (note.clientMutationId !== command.clientMutationId || note.context.nodeId !== command.nodeId
    || note.resource.bindingId !== command.resourceBindingId || note.context.blueprintVersion !== command.expectedVersion
    || note.text !== command.text || note.positionSeconds !== command.positionSeconds) throw new Error("Incoherent note receipt");
  return { ok: true, value: note };
}

export async function readLearningNoteWorkspace(client: SupabaseClient, actor: Actor): Promise<ApplicationResult<LearningNoteWorkspace>> {
  const { data, error } = await client.rpc("read_learning_note_workspace", { p_owner_id: actor.userId });
  if (error) return databaseFailure(error);
  if (!data) return { ok: false, code: "not_found" };
  const blueprint = parseBlueprintSnapshot(data.blueprint);
  if (!Array.isArray(data.records) || data.records.length > 50) throw new Error("Invalid note history");
  const records: LearningNote[] = data.records.map((row: Record<string, unknown>) => fromRow(row, actor.userId));
  if (new Set(records.map(note => note.id)).size !== records.length
    || new Set(records.map(note => note.clientMutationId)).size !== records.length
    || records.some(note => note.context.blueprintId !== blueprint.id || note.context.blueprintVersion > blueprint.version)) {
    throw new Error("Incoherent note workspace");
  }
  return { ok: true, value: { blueprint, records } };
}

function fromRow(row: Record<string, unknown>, ownerId: string): LearningNote {
  if (!row || row.owner_id !== ownerId) throw new Error("Invalid note owner");
  return learningNoteSchema.parse({
    id: row.id, clientMutationId: row.client_mutation_id,
    context: { blueprintId: row.blueprint_id, blueprintVersion: row.blueprint_version, goalId: row.goal_id, goalTitle: row.goal_title,
      stageId: row.stage_id, stageTitle: row.stage_title, nodeId: row.node_id, nodeTitle: row.node_title, nodeType: row.node_type },
    resource: { bindingId: row.resource_binding_id, videoId: row.video_id, url: row.resource_url },
    text: row.note_text, positionSeconds: row.position_seconds, createdAt: row.created_at,
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
