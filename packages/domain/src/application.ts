import { z } from "zod";

import {
  type BlueprintDiffEntry,
  type BlueprintSnapshot,
  diffBlueprints,
  parseBlueprintSnapshot,
} from "./index";

export type Actor = {
  userId: string;
  client: "web" | "extension";
};

export type BlueprintProposalRecord = {
  id: string;
  ownerId: string;
  blueprintId: string;
  baseVersion: number;
  proposedSnapshot: BlueprintSnapshot;
  proposedDiff: BlueprintDiffEntry[];
  status: "pending" | "applied" | "rejected";
  clientMutationId: string;
  appliedMutationId?: string;
  createdAt: string;
};

export type LearningSessionRecord = {
  id: string;
  ownerId: string;
  nodeId: string;
  resourceBindingId?: string;
  status: "active";
  source: "web" | "extension";
  startedAt: string;
  clientMutationId: string;
  createdAt: string;
};

export type ApplyProposalStoreResult =
  | { kind: "applied"; snapshot: BlueprintSnapshot }
  | { kind: "not_found" }
  | { kind: "version_conflict" };

export interface BlueprintStore {
  getMainBlueprint(userId: string): Promise<BlueprintSnapshot | null>;
  getProposalByMutation(userId: string, mutationId: string): Promise<BlueprintProposalRecord | null>;
  createProposal(proposal: BlueprintProposalRecord): Promise<BlueprintProposalRecord>;
  applyProposal(
    userId: string,
    proposalId: string,
    expectedVersion: number,
    mutationId: string,
  ): Promise<ApplyProposalStoreResult>;
  rejectProposal(userId: string, proposalId: string): Promise<boolean>;
  getLearningSessionByMutation(
    userId: string,
    mutationId: string,
  ): Promise<LearningSessionRecord | null>;
  createLearningSession(session: LearningSessionRecord): Promise<LearningSessionRecord>;
  listLearningSessions(userId: string): Promise<LearningSessionRecord[]>;
}

export type ApplicationErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "version_conflict"
  | "unavailable";

export type ApplicationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ApplicationErrorCode; message?: string };

const actorSchema = z.object({
  userId: z.uuid(),
  client: z.enum(["web", "extension"]),
});
const mutationIdSchema = z.uuid();

export function createBlueprintApplication(dependencies: {
  store: BlueprintStore;
  newId: () => string;
  now: () => Date;
}) {
  const { store, newId, now } = dependencies;

  return {
    async getMainBlueprint(actorInput: Actor): Promise<ApplicationResult<BlueprintSnapshot>> {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) return { ok: false, code: "unauthenticated" };
      const blueprint = await store.getMainBlueprint(actor.data.userId);
      return blueprint
        ? { ok: true, value: parseBlueprintSnapshot(blueprint) }
        : { ok: false, code: "not_found" };
    },

    async createProposal(
      actorInput: Actor,
      input: {
        draft: BlueprintSnapshot;
        baseVersion: number;
        clientMutationId: string;
      },
    ): Promise<ApplicationResult<BlueprintProposalRecord>> {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) return { ok: false, code: "unauthenticated" };
      if (actor.data.client !== "web") return { ok: false, code: "forbidden" };
      if (!mutationIdSchema.safeParse(input.clientMutationId).success) {
        return { ok: false, code: "invalid", message: "Invalid client mutation ID" };
      }

      const existing = await store.getProposalByMutation(actor.data.userId, input.clientMutationId);
      if (existing) return { ok: true, value: existing };
      const current = await store.getMainBlueprint(actor.data.userId);
      if (!current) return { ok: false, code: "not_found" };
      if (current.version !== input.baseVersion) {
        return { ok: false, code: "version_conflict" };
      }

      let draft: BlueprintSnapshot;
      try {
        draft = parseBlueprintSnapshot(input.draft);
      } catch (error) {
        return {
          ok: false,
          code: "invalid",
          message: error instanceof Error ? error.message : "Invalid Blueprint draft",
        };
      }
      if (draft.id !== current.id || draft.version !== input.baseVersion) {
        return { ok: false, code: "invalid", message: "Draft identity or version does not match" };
      }

      const proposal: BlueprintProposalRecord = {
        id: newId(),
        ownerId: actor.data.userId,
        blueprintId: current.id,
        baseVersion: input.baseVersion,
        proposedSnapshot: draft,
        proposedDiff: diffBlueprints(current, draft),
        status: "pending",
        clientMutationId: input.clientMutationId,
        createdAt: now().toISOString(),
      };
      return { ok: true, value: await store.createProposal(proposal) };
    },

    async applyProposal(
      actorInput: Actor,
      input: { proposalId: string; expectedVersion: number; clientMutationId: string },
    ): Promise<ApplicationResult<BlueprintSnapshot>> {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) return { ok: false, code: "unauthenticated" };
      if (actor.data.client !== "web") return { ok: false, code: "forbidden" };
      if (
        !z.uuid().safeParse(input.proposalId).success ||
        !mutationIdSchema.safeParse(input.clientMutationId).success ||
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 0
      ) {
        return { ok: false, code: "invalid" };
      }
      const result = await store.applyProposal(
        actor.data.userId,
        input.proposalId,
        input.expectedVersion,
        input.clientMutationId,
      );
      if (result.kind === "not_found") return { ok: false, code: "not_found" };
      if (result.kind === "version_conflict") return { ok: false, code: "version_conflict" };
      return { ok: true, value: parseBlueprintSnapshot(result.snapshot) };
    },

    async rejectProposal(
      actorInput: Actor,
      input: { proposalId: string },
    ): Promise<ApplicationResult<{ rejected: true }>> {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) return { ok: false, code: "unauthenticated" };
      if (actor.data.client !== "web") return { ok: false, code: "forbidden" };
      if (!z.uuid().safeParse(input.proposalId).success) return { ok: false, code: "invalid" };
      return (await store.rejectProposal(actor.data.userId, input.proposalId))
        ? { ok: true, value: { rejected: true } }
        : { ok: false, code: "not_found" };
    },

    async startLearningSession(
      actorInput: Actor,
      input: {
        nodeId: string;
        resourceBindingId?: string;
        clientMutationId: string;
        startedAt: string;
      },
    ): Promise<ApplicationResult<LearningSessionRecord>> {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) return { ok: false, code: "unauthenticated" };
      const parsed = z
        .object({
          nodeId: z.uuid(),
          resourceBindingId: z.uuid().optional(),
          clientMutationId: mutationIdSchema,
          startedAt: z.iso.datetime(),
        })
        .safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const existing = await store.getLearningSessionByMutation(
        actor.data.userId,
        parsed.data.clientMutationId,
      );
      if (existing) return { ok: true, value: existing };
      const createdAt = now().toISOString();
      const session: LearningSessionRecord = {
        id: newId(),
        ownerId: actor.data.userId,
        nodeId: parsed.data.nodeId,
        resourceBindingId: parsed.data.resourceBindingId,
        status: "active",
        source: actor.data.client,
        startedAt: parsed.data.startedAt,
        clientMutationId: parsed.data.clientMutationId,
        createdAt,
      };
      return { ok: true, value: await store.createLearningSession(session) };
    },

    async listLearningSessions(
      actorInput: Actor,
    ): Promise<ApplicationResult<LearningSessionRecord[]>> {
      const actor = actorSchema.safeParse(actorInput);
      if (!actor.success) return { ok: false, code: "unauthenticated" };
      return { ok: true, value: await store.listLearningSessions(actor.data.userId) };
    },
  };
}
