import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ApplyProposalStoreResult,
  type BlueprintProposalRecord,
  type BlueprintSnapshot,
  type BlueprintStore,
  type LearningSessionRecord,
  parseBlueprintSnapshot,
} from "@blueprint/domain";

type LooseClient = SupabaseClient<any, "public", any>;

export function createSupabaseBlueprintStore(client: LooseClient): BlueprintStore {
  const store: BlueprintStore = {
    async getMainBlueprint(userId) {
      const { data: blueprint, error: blueprintError } = await client
        .from("blueprints")
        .select("id, title, version")
        .eq("owner_id", userId)
        .maybeSingle();
      if (blueprintError) throw blueprintError;
      if (!blueprint) return null;

      const { data: goals, error: goalsError } = await client
        .from("goals")
        .select("id, title, description, position")
        .eq("blueprint_id", blueprint.id)
        .is("archived_at", null)
        .order("position");
      if (goalsError) throw goalsError;
      const goalIds = (goals ?? []).map((goal: any) => goal.id);
      const stages = goalIds.length
        ? await selectMany(client, "stages", "id, goal_id, title, position", "goal_id", goalIds)
        : [];
      const stageIds = stages.map((stage: any) => stage.id);
      const nodes = stageIds.length
        ? await selectMany(
            client,
            "path_nodes",
            "id, stage_id, node_type, title, description, position",
            "stage_id",
            stageIds,
          )
        : [];
      const nodeIds = nodes.map((node: any) => node.id);
      const dependencies = nodeIds.length
        ? await selectMany(
            client,
            "path_node_dependencies",
            "node_id, dependency_id",
            "node_id",
            nodeIds,
            false,
          )
        : [];
      const resources = nodeIds.length
        ? await selectMany(
            client,
            "resource_bindings",
            "id, node_id, kind, url, external_id, position",
            "node_id",
            nodeIds,
          )
        : [];

      return parseBlueprintSnapshot({
        schemaVersion: 1,
        id: blueprint.id,
        version: Number(blueprint.version),
        title: blueprint.title,
        goals: (goals ?? []).map((goal: any) => ({
          id: goal.id,
          title: goal.title,
          ...(goal.description ? { description: goal.description } : {}),
          position: goal.position,
          stages: stages
            .filter((stage: any) => stage.goal_id === goal.id)
            .sort(byPosition)
            .map((stage: any) => ({
              id: stage.id,
              title: stage.title,
              position: stage.position,
              nodes: nodes
                .filter((node: any) => node.stage_id === stage.id)
                .sort(byPosition)
                .map((node: any) => ({
                  id: node.id,
                  type: node.node_type,
                  title: node.title,
                  ...(node.description ? { description: node.description } : {}),
                  position: node.position,
                  dependencyIds: dependencies
                    .filter((dependency: any) => dependency.node_id === node.id)
                    .map((dependency: any) => dependency.dependency_id),
                  resources: resources
                    .filter((resource: any) => resource.node_id === node.id)
                    .sort(byPosition)
                    .map((resource: any) => ({
                      id: resource.id,
                      kind: resource.kind,
                      url: resource.url,
                      externalId: resource.external_id,
                    })),
                })),
            })),
        })),
      });
    },

    async getProposalByMutation(userId, mutationId) {
      const { data, error } = await client
        .from("blueprint_proposals")
        .select("*")
        .eq("owner_id", userId)
        .eq("client_mutation_id", mutationId)
        .maybeSingle();
      if (error) throw error;
      return data ? proposalFromRow(data) : null;
    },

    async createProposal(proposal) {
      const { data, error } = await client
        .from("blueprint_proposals")
        .insert({
          id: proposal.id,
          owner_id: proposal.ownerId,
          blueprint_id: proposal.blueprintId,
          base_version: proposal.baseVersion,
          proposed_snapshot: proposal.proposedSnapshot,
          proposed_diff: proposal.proposedDiff,
          status: proposal.status,
          client_mutation_id: proposal.clientMutationId,
          created_at: proposal.createdAt,
        })
        .select("*")
        .single();
      if (error) throw error;
      return proposalFromRow(data);
    },

    async applyProposal(userId, proposalId, expectedVersion, mutationId) {
      const { error } = await client.rpc("apply_blueprint_proposal", {
        proposal_id: proposalId,
        expected_version: expectedVersion,
        mutation_id: mutationId,
      });
      if (error) {
        if (/VERSION_CONFLICT|PROPOSAL_NOT_PENDING/.test(error.message)) {
          return { kind: "version_conflict" };
        }
        if (/NOT_FOUND/.test(error.message)) return { kind: "not_found" };
        throw error;
      }
      const snapshot = await store.getMainBlueprint(userId);
      if (!snapshot) return { kind: "not_found" };
      return { kind: "applied", snapshot } satisfies ApplyProposalStoreResult;
    },

    async rejectProposal(userId, proposalId) {
      const { data, error } = await client
        .from("blueprint_proposals")
        .update({ status: "rejected", rejected_at: new Date().toISOString() })
        .eq("id", proposalId)
        .eq("owner_id", userId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async getLearningSessionByMutation(userId, mutationId) {
      const { data, error } = await client
        .from("learning_sessions")
        .select("*")
        .eq("owner_id", userId)
        .eq("client_mutation_id", mutationId)
        .maybeSingle();
      if (error) throw error;
      return data ? sessionFromRow(data) : null;
    },

    async createLearningSession(session) {
      const { data, error } = await client
        .from("learning_sessions")
        .insert({
          id: session.id,
          owner_id: session.ownerId,
          node_id: session.nodeId,
          resource_binding_id: session.resourceBindingId ?? null,
          status: session.status,
          source: session.source,
          started_at: session.startedAt,
          client_mutation_id: session.clientMutationId,
          created_at: session.createdAt,
        })
        .select("*")
        .single();
      if (error) throw error;
      return sessionFromRow(data);
    },

    async listLearningSessions(userId) {
      const { data, error } = await client
        .from("learning_sessions")
        .select("*")
        .eq("owner_id", userId)
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map(sessionFromRow);
    },
  };
  return store;
}

async function selectMany(
  client: LooseClient,
  table: string,
  columns: string,
  foreignKey: string,
  ids: string[],
  activeOnly = true,
): Promise<any[]> {
  let query = client.from(table).select(columns).in(foreignKey, ids);
  if (activeOnly) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

function proposalFromRow(row: any): BlueprintProposalRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    blueprintId: row.blueprint_id,
    baseVersion: Number(row.base_version),
    proposedSnapshot: parseBlueprintSnapshot(row.proposed_snapshot),
    proposedDiff: row.proposed_diff,
    status: row.status,
    clientMutationId: row.client_mutation_id,
    ...(row.applied_mutation_id ? { appliedMutationId: row.applied_mutation_id } : {}),
    createdAt: row.created_at,
  };
}

function sessionFromRow(row: any): LearningSessionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    nodeId: row.node_id,
    ...(row.resource_binding_id ? { resourceBindingId: row.resource_binding_id } : {}),
    status: "active",
    source: row.source,
    startedAt: row.started_at,
    clientMutationId: row.client_mutation_id,
    createdAt: row.created_at,
  };
}

function byPosition(left: any, right: any): number {
  return left.position - right.position;
}
