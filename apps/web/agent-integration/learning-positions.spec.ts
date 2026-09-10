import { afterEach, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createBlueprintApplication, type BlueprintSnapshot } from "@blueprint/domain";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createSupabaseBlueprintStore } from "../src/lib/supabase/store";
import { readLearningPositionWorkspace, recordLearningPosition } from "../src/lib/learning-positions";

const local = localSupabaseTestConfig();
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions });
const accounts: Array<{ id: string; client: SupabaseClient }> = [];
afterEach(async () => {
  for (const { id, client } of accounts.splice(0)) {
    await client.auth.signOut(); expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
  }
});
async function fixture() {
  const id = randomUUID(), email = `${id}@learning-positions.example.test`, password = randomUUID();
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
  const nodeId = randomUUID(), bindingId = randomUUID();
  const draft: BlueprintSnapshot = { ...blank, goals: [{ id: randomUUID(), title: "把照片拍清楚", position: 0, stages: [{ id: randomUUID(), title: "认识曝光", position: 0,
    nodes: [{ id: nodeId, title: "理解光圈和快门", type: "learn", position: 0, estimatedMinutes: 30, completionCriteria: "解释两张照片的曝光差异", dependencyIds: [],
      resources: [{ id: bindingId, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] };
  async function apply(draft: BlueprintSnapshot) {
    const proposal = await application.createProposal(actor, { draft, baseVersion: draft.version, clientMutationId: randomUUID() });
    if (!proposal.ok) throw new Error("Missing proposal");
    const result = await application.applyProposal(actor, { proposalId: proposal.value.id, expectedVersion: draft.version, clientMutationId: randomUUID() });
    if (!result.ok) throw new Error("Cannot confirm test path");
    return result.value;
  }
  const blueprint = await apply(draft);
  const input = { nodeId, resourceBindingId: bindingId, expectedVersion: blueprint.version, expectedPositionVersion: 0, clientMutationId: randomUUID(), positionSeconds: 125 };
  return { id, client, actor, store, application, blueprint, input, apply, email, password };
}

it("a second signed-in device reads the explicit position while formal progress remains untouched", async () => {
  const owner = await fixture();
  const saved = await recordLearningPosition(owner.client, owner.actor, owner.input);
  expect(saved.ok).toBe(true); if (!saved.ok) throw new Error("Position not saved");
  expect(saved.value).toMatchObject({ clientMutationId: owner.input.clientMutationId, positionSeconds: 125, positionVersion: 1, expectedPositionVersion: 0,
    context: { blueprintId: owner.blueprint.id, blueprintVersion: 1, nodeId: owner.input.nodeId, nodeTitle: "理解光圈和快门" },
    resource: { bindingId: owner.input.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" } });
  const second = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: authOptions });
  expect((await second.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
  try {
    expect(await readLearningPositionWorkspace(second, owner.actor)).toEqual({ ok: true, value: { blueprint: owner.blueprint, records: [saved.value] } });
    expect(await owner.store.getMainBlueprint(owner.id)).toEqual(owner.blueprint);
    expect(await owner.application.listLearningSessions(owner.actor)).toEqual({ ok: true, value: [] });
    for (const table of ["progress_evidence", "node_status_confirmations", "learning_notes"]) {
      const records = await owner.client.from(table).select("id"); expect(records.error).toBeNull(); expect(records.data).toEqual([]);
    }
  } finally { await second.auth.signOut(); }
});

it("concurrent devices cannot overwrite a newer position; backwards seeks are valid and old retries never become latest", async () => {
  const owner = await fixture();
  const [first, duplicate] = await Promise.all([recordLearningPosition(owner.client, owner.actor, owner.input), recordLearningPosition(owner.client, owner.actor, owner.input)]);
  expect(first.ok).toBe(true); expect(duplicate).toEqual(first);
  const left = { ...owner.input, clientMutationId: randomUUID(), expectedPositionVersion: 1, positionSeconds: 200 };
  const right = { ...left, clientMutationId: randomUUID(), positionSeconds: 300 };
  const contenders = await Promise.all([recordLearningPosition(owner.client, owner.actor, left), recordLearningPosition(owner.client, owner.actor, right)]);
  expect(contenders.filter(result => result.ok)).toHaveLength(1);
  expect(contenders.filter(result => !result.ok)).toEqual([{ ok: false, code: "version_conflict" }]);
  const back = await recordLearningPosition(owner.client, owner.actor, { ...owner.input, expectedPositionVersion: 2, positionSeconds: 0, clientMutationId: randomUUID() });
  expect(back.ok).toBe(true); if (!back.ok) throw new Error("Cannot save backwards position");
  expect(back.value).toMatchObject({ positionSeconds: 0, positionVersion: 3 });
  expect(await recordLearningPosition(owner.client, owner.actor, owner.input)).toEqual(first);
  expect(await readLearningPositionWorkspace(owner.client, owner.actor)).toEqual({ ok: true, value: { blueprint: owner.blueprint, records: [back.value] } });
  for (const change of [{ positionSeconds: 0 }, { expectedPositionVersion: 1 }, { expectedVersion: 2 }, { nodeId: randomUUID() }, { resourceBindingId: randomUUID() }]) {
    expect(await recordLearningPosition(owner.client, owner.actor, { ...owner.input, ...change })).toEqual({ ok: false, code: "invalid" });
  }
});

it("replacement and archive preserve original receipts and never move position to a different video", async () => {
  const owner = await fixture();
  const saved = await recordLearningPosition(owner.client, owner.actor, owner.input); expect(saved.ok).toBe(true);
  const replacementId = randomUUID();
  const changed = await owner.apply({ ...owner.blueprint, goals: owner.blueprint.goals.map(goal => ({ ...goal, title: "新的目标", stages: goal.stages.map(stage => ({ ...stage,
    nodes: stage.nodes.map(node => ({ ...node, title: "新的节点", resources: [{ id: replacementId, kind: "youtube_video" as const, externalId: "lmnopqrstuv", url: "https://www.youtube.com/watch?v=lmnopqrstuv" }] })) })) })) });
  expect(await recordLearningPosition(owner.client, owner.actor, owner.input)).toEqual(saved);
  expect(await recordLearningPosition(owner.client, owner.actor, { ...owner.input, clientMutationId: randomUUID(), expectedPositionVersion: 1 })).toEqual({ ok: false, code: "version_conflict" });
  expect(await recordLearningPosition(owner.client, owner.actor, { ...owner.input, clientMutationId: randomUUID(), expectedVersion: changed.version, expectedPositionVersion: 1 })).toEqual({ ok: false, code: "not_found" });
  const replacement = await recordLearningPosition(owner.client, owner.actor, { ...owner.input, resourceBindingId: replacementId,
    expectedVersion: changed.version, positionSeconds: 42, clientMutationId: randomUUID() });
  expect(replacement.ok).toBe(true); if (!replacement.ok || !saved.ok) throw new Error("Position not saved");
  expect(replacement.value).toMatchObject({ positionVersion: 1, resource: { videoId: "lmnopqrstuv" } });
  const archived = await owner.apply({ ...changed, goals: [] });
  expect(await recordLearningPosition(owner.client, owner.actor, owner.input)).toEqual(saved);
  expect(await readLearningPositionWorkspace(owner.client, owner.actor)).toEqual({ ok: true, value: { blueprint: archived, records: [replacement.value, saved.value] } });
});

it("two accounts cannot read or change each other's positions and table writes are denied", async () => {
  const owner = await fixture(), other = await fixture();
  expect((await recordLearningPosition(owner.client, owner.actor, owner.input)).ok).toBe(true);
  expect(await readLearningPositionWorkspace(other.client, other.actor)).toEqual({ ok: true, value: { blueprint: other.blueprint, records: [] } });
  expect(await readLearningPositionWorkspace(other.client, owner.actor)).toEqual({ ok: false, code: "not_found" });
  expect(await recordLearningPosition(other.client, other.actor, owner.input)).toEqual({ ok: false, code: "not_found" });
  expect((await other.client.from("learning_positions").select("id").eq("owner_id", owner.id)).data).toEqual([]);
  expect((await owner.client.from("learning_positions").insert({ owner_id: owner.id })).error?.code).toBe("42501");
  expect((await owner.client.from("learning_positions").update({ position_seconds: 999 }).eq("owner_id", owner.id)).error?.code).toBe("42501");
});

it("editing a resource in place does not rewrite its saved video identity or permit a stale save", async () => {
  const owner = await fixture();
  const saved = await recordLearningPosition(owner.client, owner.actor, owner.input); expect(saved.ok).toBe(true);
  const changed = await owner.apply({ ...owner.blueprint, goals: owner.blueprint.goals.map(goal => ({ ...goal, stages: goal.stages.map(stage => ({ ...stage,
    nodes: stage.nodes.map(node => ({ ...node, resources: node.resources.map(resource => ({ ...resource, externalId: "lmnopqrstuv", url: "https://www.youtube.com/watch?v=lmnopqrstuv" })) })) })) })) });
  expect(await recordLearningPosition(owner.client, owner.actor, owner.input)).toEqual(saved);
  expect(await recordLearningPosition(owner.client, owner.actor, { ...owner.input, clientMutationId: randomUUID(), expectedPositionVersion: 1 })).toEqual({ ok: false, code: "version_conflict" });
  expect(await readLearningPositionWorkspace(owner.client, owner.actor)).toEqual({ ok: true, value: { blueprint: changed, records: saved.ok ? [saved.value] : [] } });
  const next = await recordLearningPosition(owner.client, owner.actor, { ...owner.input, clientMutationId: randomUUID(), expectedVersion: changed.version, expectedPositionVersion: 1, positionSeconds: 0 });
  expect(next.ok).toBe(true); if (!next.ok) throw new Error("New source position not saved");
  expect(next.value).toMatchObject({ positionVersion: 2, positionSeconds: 0, resource: { videoId: "lmnopqrstuv" } });
  expect(await recordLearningPosition(owner.client, owner.actor, owner.input)).toEqual(saved);
  expect(await readLearningPositionWorkspace(owner.client, owner.actor)).toEqual({ ok: true, value: { blueprint: changed, records: [next.value] } });
});

it("UUID case and the maximum position preserve exact recovery through real PostgreSQL", async () => {
  const owner = await fixture(); let expectedPositionVersion = 0;
  for (const field of ["nodeId", "resourceBindingId", "clientMutationId"] as const) {
    const original = { ...owner.input, expectedPositionVersion, positionSeconds: 2147483647, clientMutationId: randomUUID() };
    const input = { ...original, [field]: original[field].toUpperCase() };
    const saved = await recordLearningPosition(owner.client, owner.actor, input);
    expect(saved.ok).toBe(true); if (!saved.ok) throw new Error("Position not saved");
    expect(saved.value).toMatchObject({ clientMutationId: original.clientMutationId, positionVersion: ++expectedPositionVersion,
      context: { nodeId: original.nodeId }, resource: { bindingId: original.resourceBindingId }, positionSeconds: 2147483647 });
    expect(await recordLearningPosition(owner.client, owner.actor, original)).toEqual(saved);
  }
});

it("a resource outside the recent fifty can recover its version and explicitly become current without losing other bindings", async () => {
  const owner = await fixture();
  const bindings = Array.from({ length: 51 }, (_, index) => {
    const videoId = `video${String(index).padStart(6, "0")}`;
    return { id: randomUUID(), kind: "youtube_video" as const, externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
  });
  const source = owner.blueprint.goals[0].stages[0].nodes[0];
  const nodes = Array.from({ length: 4 }, (_, index) => ({ ...source, id: index === 0 ? source.id : randomUUID(), position: index,
    resources: bindings.slice(index * 16, (index + 1) * 16) }));
  const blueprint = await owner.apply({ ...owner.blueprint, goals: owner.blueprint.goals.map(goal => ({ ...goal, stages: goal.stages.map(stage => ({ ...stage,
    nodes })) })) });
  for (const [index, binding] of bindings.entries()) {
    expect((await recordLearningPosition(owner.client, owner.actor, { ...owner.input, nodeId: nodes[Math.floor(index / 16)].id, resourceBindingId: binding.id, expectedVersion: blueprint.version,
      positionSeconds: 17, clientMutationId: randomUUID() })).ok).toBe(true);
  }
  const recent = await readLearningPositionWorkspace(owner.client, owner.actor);
  expect(recent.ok).toBe(true); if (!recent.ok) throw new Error("No workspace");
  expect(recent.value.records).toHaveLength(50);
  expect(recent.value.records.some(record => record.resource.bindingId === bindings[0].id)).toBe(false);
  const older = await readLearningPositionWorkspace(owner.client, owner.actor, bindings[0].id.toUpperCase());
  expect(older.ok).toBe(true); if (!older.ok) throw new Error("No older binding");
  expect(older.value.records).toHaveLength(1);
  expect(older.value.records[0]).toMatchObject({ positionVersion: 1, positionSeconds: 17, resource: { bindingId: bindings[0].id } });
  const next = await recordLearningPosition(owner.client, owner.actor, { ...owner.input, expectedVersion: blueprint.version, resourceBindingId: bindings[0].id,
    expectedPositionVersion: older.value.records[0].positionVersion, positionSeconds: 42, clientMutationId: randomUUID() });
  expect(next.ok).toBe(true); if (!next.ok) throw new Error("Cannot update older binding");
  const refreshed = await readLearningPositionWorkspace(owner.client, owner.actor);
  expect(refreshed.ok && refreshed.value.records[0]).toEqual(next.value);
  expect(await readLearningPositionWorkspace(owner.client, owner.actor, randomUUID())).toEqual({ ok: true, value: { blueprint, records: [] } });
});
