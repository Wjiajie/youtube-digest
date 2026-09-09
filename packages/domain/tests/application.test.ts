import { describe, expect, it } from "vitest";

import {
  type Actor,
  type BlueprintProposalRecord,
  type BlueprintSnapshot,
  type BlueprintStore,
  type LearningSessionRecord,
  createBlueprintApplication,
  parseBlueprintSnapshot,
} from "../src/index";

const owner: Actor = {
  userId: "018f6f68-9b4d-7c93-a134-c8571b8f7701",
  client: "web",
};
const extensionActor: Actor = { ...owner, client: "extension" };

function emptyBlueprint(): BlueprintSnapshot {
  return parseBlueprintSnapshot({
    schemaVersion: 2,
    id: "018f6f68-9b4d-7c93-a134-c8571b8f7702",
    version: 0,
    title: "我的蓝图",
    goals: [],
  });
}

class MemoryStore implements BlueprintStore {
  blueprint = emptyBlueprint();
  proposals = new Map<string, BlueprintProposalRecord>();
  sessions = new Map<string, LearningSessionRecord>();

  async getMainBlueprint() {
    return this.blueprint;
  }

  async getProposalByMutation(userId: string, mutationId: string) {
    return [...this.proposals.values()].find(
      (proposal) => proposal.ownerId === userId && proposal.clientMutationId === mutationId,
    ) ?? null;
  }

  async createProposal(proposal: BlueprintProposalRecord) {
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async applyProposal(
    userId: string,
    proposalId: string,
    expectedVersion: number,
    mutationId: string,
  ) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.ownerId !== userId) return { kind: "not_found" as const };
    if (proposal.status === "applied" && proposal.appliedMutationId === mutationId) {
      return { kind: "applied" as const, snapshot: this.blueprint };
    }
    if (proposal.status !== "pending" || this.blueprint.version !== expectedVersion) {
      return { kind: "version_conflict" as const };
    }
    this.blueprint = { ...proposal.proposedSnapshot, version: expectedVersion + 1 };
    this.proposals.set(proposalId, {
      ...proposal,
      status: "applied",
      appliedMutationId: mutationId,
    });
    return { kind: "applied" as const, snapshot: this.blueprint };
  }

  async rejectProposal(userId: string, proposalId: string) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.ownerId !== userId) return false;
    this.proposals.set(proposalId, { ...proposal, status: "rejected" });
    return true;
  }

  async getLearningSessionByMutation(userId: string, mutationId: string) {
    return [...this.sessions.values()].find(
      (session) => session.ownerId === userId && session.clientMutationId === mutationId,
    ) ?? null;
  }

  async createLearningSession(session: LearningSessionRecord) {
    this.sessions.set(session.id, session);
    return session;
  }

  async listLearningSessions(userId: string) {
    return [...this.sessions.values()].filter((session) => session.ownerId === userId);
  }
}

describe("Blueprint application", () => {
  it("keeps an extension from creating Blueprint proposals", async () => {
    const application = createBlueprintApplication({
      store: new MemoryStore(),
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-08-26T00:00:00Z"),
    });

    const result = await application.createProposal(extensionActor, {
      draft: emptyBlueprint(),
      baseVersion: 0,
      clientMutationId: crypto.randomUUID(),
    });

    expect(result).toEqual({ ok: false, code: "forbidden" });
  });

  it("creates and atomically applies a user-confirmed proposal", async () => {
    const store = new MemoryStore();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const application = createBlueprintApplication({
      store,
      newId: () => ids.shift()!,
      now: () => new Date("2026-08-26T00:00:00Z"),
    });
    const draft = { ...emptyBlueprint(), title: "职业成长蓝图" };
    const create = await application.createProposal(owner, {
      draft,
      baseVersion: 0,
      clientMutationId: crypto.randomUUID(),
    });
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const applied = await application.applyProposal(owner, {
      proposalId: create.value.id,
      expectedVersion: 0,
      clientMutationId: crypto.randomUUID(),
    });

    expect(applied).toMatchObject({ ok: true, value: { version: 1, title: "职业成长蓝图" } });
  });

  it("starts one learning session for repeated extension delivery", async () => {
    const store = new MemoryStore();
    const application = createBlueprintApplication({
      store,
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-08-26T00:00:00Z"),
    });
    const clientMutationId = crypto.randomUUID();
    const input = {
      nodeId: crypto.randomUUID(),
      resourceBindingId: crypto.randomUUID(),
      clientMutationId,
      startedAt: "2026-08-26T00:00:00.000Z",
    };

    const first = await application.startLearningSession(extensionActor, input);
    const replay = await application.startLearningSession(extensionActor, input);

    expect(first).toEqual(replay);
    expect(store.sessions).toHaveLength(1);
    expect(await application.listLearningSessions(owner)).toMatchObject({
      ok: true,
      value: [{ nodeId: input.nodeId }],
    });
  });

  it("carries a confirmed Web path through extension read and back to Web session history", async () => {
    const store = new MemoryStore();
    const application = createBlueprintApplication({
      store,
      newId: () => crypto.randomUUID(),
      now: () => new Date("2026-08-26T00:00:00Z"),
    });
    const goalId = crypto.randomUUID();
    const stageId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    const resourceBindingId = crypto.randomUUID();
    const draft = parseBlueprintSnapshot({
      ...emptyBlueprint(),
      title: "职业成长蓝图",
      goals: [{
        id: goalId,
        title: "成为数据分析师",
        position: 0,
        stages: [{
          id: stageId,
          title: "数据基础",
          position: 0,
          nodes: [{
            id: nodeId,
            type: "learn",
            title: "理解 SQL 查询",
            estimatedMinutes: null,
            completionCriteria: "",
            position: 0,
            dependencyIds: [],
            resources: [{
              id: resourceBindingId,
              kind: "youtube_video",
              url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              externalId: "dQw4w9WgXcQ",
            }],
          }],
        }],
      }],
    });

    const proposal = await application.createProposal(owner, {
      draft,
      baseVersion: 0,
      clientMutationId: crypto.randomUUID(),
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const applied = await application.applyProposal(owner, {
      proposalId: proposal.value.id,
      expectedVersion: 0,
      clientMutationId: crypto.randomUUID(),
    });
    expect(applied.ok).toBe(true);

    const extensionRead = await application.getMainBlueprint(extensionActor);
    expect(extensionRead).toMatchObject({
      ok: true,
      value: {
        version: 1,
        goals: [{ stages: [{ nodes: [{ id: nodeId, resources: [{ id: resourceBindingId }] }] }] }],
      },
    });
    const started = await application.startLearningSession(extensionActor, {
      nodeId,
      resourceBindingId,
      clientMutationId: crypto.randomUUID(),
      startedAt: "2026-08-26T01:00:00.000Z",
    });
    expect(started.ok).toBe(true);
    expect(await application.listLearningSessions(owner)).toMatchObject({
      ok: true,
      value: [{ nodeId, resourceBindingId, source: "extension" }],
    });
  });
});
