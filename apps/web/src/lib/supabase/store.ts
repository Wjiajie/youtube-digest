import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ApplyProposalStoreResult,
  type BlueprintProposalRecord,
  type BlueprintStore,
  type LearningSessionRecord,
  parseBlueprintSnapshot,
  parseCurrentBlueprintSnapshot,
} from "@blueprint/domain";

type LooseClient = SupabaseClient<any, "public", any>;

export function createSupabaseBlueprintStore(client: LooseClient): BlueprintStore {
  const store: BlueprintStore = {
    async getMainBlueprint(userId) {
      // Root version and every nested entity must come from one database snapshot.
      const { data, error } = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: userId });
      if (error) throw error;
      return data === null ? null : parseCurrentBlueprintSnapshot(data);
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
        if (error.code === "23514" && ["BLUEPRINT_SNAPSHOT_INVALID", "NODE_PLANNING_INVALID"].includes(error.message)) return { kind: "invalid" };
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
