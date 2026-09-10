import { afterEach, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createBlueprintApplication, type BlueprintSnapshot } from "@blueprint/domain";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createSupabaseBlueprintStore } from "../src/lib/supabase/store";

const local = localSupabaseTestConfig();
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions });
const accounts: Array<{ id: string; client: SupabaseClient }> = [];
afterEach(async () => {
  for (const { id, client } of accounts.splice(0)) {
    await client.auth.signOut(); expect((await admin.auth.admin.deleteUser(id)).error?.code ?? null).toBeNull();
  }
});
async function fixture() {
  const id = randomUUID(), email = `${id}@resource-order.example.test`, password = randomUUID();
  expect((await admin.auth.admin.createUser({ id, email, password, email_confirm: true })).error).toBeNull();
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: authOptions }); accounts.push({ id, client });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  for (let attempt = 0; attempt < 6; attempt++) {
    const probe = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
    if (!probe.error) break;
    if (probe.error.code !== "PGRST303" || attempt === 5) throw new Error(`Local read unavailable: ${probe.error.code}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const actor = { userId: id, client: "web" as const }, store = createSupabaseBlueprintStore(client);
  const application = createBlueprintApplication({ store, newId: randomUUID, now: () => new Date() });
  const blank = await store.getMainBlueprint(id); if (!blank) throw new Error("Missing Blueprint");
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
  const resources = ["abcdefghijk", "lmnopqrstuv", "12345678901"].map((externalId, index) => ({ id: ids[index], kind: "youtube_video" as const, externalId, url: `https://www.youtube.com/watch?v=${externalId}` }));
  const nodeId = randomUUID();
  const draft: BlueprintSnapshot = { ...blank, goals: [{ id: randomUUID(), title: "完成摄影练习", position: 0, stages: [{ id: randomUUID(), title: "掌握曝光", position: 0,
    nodes: [{ id: nodeId, title: "比较曝光设置", type: "learn", position: 0, estimatedMinutes: 30, completionCriteria: "提交三张对比照片", dependencyIds: [], resources: resources.slice(0, 2) }] }] }] };
  async function propose(draft: BlueprintSnapshot) {
    const proposal = await application.createProposal(actor, { draft, baseVersion: draft.version, clientMutationId: randomUUID() });
    if (!proposal.ok) throw new Error("Missing proposal");
    return { proposalId: proposal.value.id, expectedVersion: draft.version, clientMutationId: randomUUID() };
  }
  return { id, client, actor, store, application, draft, resources, nodeId, propose };
}

it("manual confirmation preserves the reviewed resource sequence in the public snapshot and immutable revision", async () => {
  const owner = await fixture(), command = await owner.propose(owner.draft);
  expect((await owner.application.applyProposal(owner.actor, command)).ok).toBe(true);
  const formal = await owner.store.getMainBlueprint(owner.id);
  expect(formal?.goals[0].stages[0].nodes[0].resources.map(resource => resource.externalId)).toEqual(["abcdefghijk", "lmnopqrstuv"]);
  const revision = await owner.client.from("blueprint_revisions").select("snapshot").eq("proposal_id", command.proposalId).single();
  expect(revision.error).toBeNull();
  expect(revision.data?.snapshot.goals[0].stages[0].nodes[0].resources).toEqual(formal?.goals[0].stages[0].nodes[0].resources);
});

it("reordering, appending and removing resources preserves learning attribution and exact historical apply receipts", async () => {
  const owner = await fixture(), first = await owner.propose(owner.draft);
  expect((await owner.application.applyProposal(owner.actor, first)).ok).toBe(true);
  expect((await owner.application.startLearningSession(owner.actor, { nodeId: owner.nodeId, resourceBindingId: owner.resources[0].id,
    clientMutationId: randomUUID(), startedAt: new Date().toISOString() })).ok).toBe(true);
  const sessions = await owner.application.listLearningSessions(owner.actor);
  const current = await owner.store.getMainBlueprint(owner.id); if (!current) throw new Error("Missing current Blueprint");
  const revised = { ...current, goals: current.goals.map(goal => ({ ...goal, stages: goal.stages.map(stage => ({ ...stage,
    nodes: stage.nodes.map(node => ({ ...node, resources: [owner.resources[2], owner.resources[1], owner.resources[0]] })) })) })) };
  const second = await owner.propose(revised);
  expect((await owner.application.applyProposal(owner.actor, second)).ok).toBe(true);
  const appended = await owner.store.getMainBlueprint(owner.id); if (!appended) throw new Error("Missing appended Blueprint");
  expect(appended.goals[0].stages[0].nodes[0].resources.map(resource => resource.externalId)).toEqual(["12345678901", "lmnopqrstuv", "abcdefghijk"]);
  expect(await owner.application.listLearningSessions(owner.actor)).toEqual(sessions);
  const removed = { ...appended, goals: appended.goals.map(goal => ({ ...goal, stages: goal.stages.map(stage => ({ ...stage,
    nodes: stage.nodes.map(node => ({ ...node, resources: [owner.resources[1], owner.resources[2]] })) })) })) };
  expect((await owner.application.applyProposal(owner.actor, await owner.propose(removed))).ok).toBe(true);
  const official = await owner.store.getMainBlueprint(owner.id);
  expect(official?.version).toBe(3);
  expect(official?.goals[0].stages[0].nodes[0].resources.map(resource => resource.externalId)).toEqual(["lmnopqrstuv", "12345678901"]);
  expect(await owner.application.listLearningSessions(owner.actor)).toEqual(sessions);
  const archived = await owner.client.from("resource_bindings").select("id,node_id,external_id,archived_at").eq("id", owner.resources[0].id).single();
  expect(archived.error).toBeNull(); expect(archived.data).toMatchObject({ node_id: owner.nodeId, external_id: "abcdefghijk", archived_at: expect.any(String) });
  const replay = await owner.client.rpc("apply_blueprint_proposal", { proposal_id: first.proposalId, expected_version: first.expectedVersion, mutation_id: first.clientMutationId });
  expect(replay.error).toBeNull(); expect(replay.data).toBe(1);
  expect(await owner.store.getMainBlueprint(owner.id)).toEqual(official);
  const revision = await owner.client.from("blueprint_revisions").select("snapshot").eq("proposal_id", first.proposalId).single();
  expect(revision.error).toBeNull(); expect(revision.data?.snapshot.goals[0].stages[0].nodes[0].resources.map((resource: { externalId: string }) => resource.externalId)).toEqual(["abcdefghijk", "lmnopqrstuv"]);
});
