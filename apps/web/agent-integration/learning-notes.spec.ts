import { afterEach, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createBlueprintApplication, type BlueprintSnapshot } from "@blueprint/domain";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createSupabaseBlueprintStore } from "../src/lib/supabase/store";
import { readLearningNoteWorkspace, recordLearningNote } from "../src/lib/learning-notes";

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
  const id = randomUUID(), email = `${id}@learning-notes.example.test`, password = randomUUID();
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
  const input = { nodeId, resourceBindingId: bindingId, expectedVersion: blueprint.version, clientMutationId: randomUUID(), text: "  02:05 对比光圈变化。\n先保留这个疑问。\n", positionSeconds: 125 };
  return { id, client, actor, store, application, blueprint, input, apply, email, password };
}

it("a real account saves a timestamp note and another signed-in client reads the same historical source without changing progress", async () => {
  const owner = await fixture();
  const saved = await recordLearningNote(owner.client, owner.actor, owner.input);
  expect(saved.ok).toBe(true); if (!saved.ok) throw new Error("Note not saved");
  expect(saved.value).toMatchObject({ clientMutationId: owner.input.clientMutationId, text: owner.input.text, positionSeconds: 125,
    context: { blueprintId: owner.blueprint.id, blueprintVersion: 1, nodeId: owner.input.nodeId, nodeTitle: "理解光圈和快门" },
    resource: { bindingId: owner.input.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" } });
  const second = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: authOptions });
  expect((await second.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
  try {
    expect(await readLearningNoteWorkspace(second, owner.actor)).toEqual({ ok: true, value: { blueprint: owner.blueprint, records: [saved.value] } });
    expect(await owner.store.getMainBlueprint(owner.id)).toEqual(owner.blueprint);
    expect(await owner.application.listLearningSessions(owner.actor)).toEqual({ ok: true, value: [] });
    const evidence = await owner.client.from("progress_evidence").select("id");
    const status = await owner.client.from("node_status_confirmations").select("id");
    expect(evidence.error).toBeNull(); expect(evidence.data).toEqual([]);
    expect(status.error).toBeNull(); expect(status.data).toEqual([]);
  } finally { await second.auth.signOut(); }
});

it("concurrent retries create one note and exact recovery survives a changed, archived resource and node", async () => {
  const owner = await fixture();
  const [first, concurrent] = await Promise.all([recordLearningNote(owner.client, owner.actor, owner.input), recordLearningNote(owner.client, owner.actor, owner.input)]);
  expect(first.ok).toBe(true); expect(concurrent).toEqual(first);
  const changed = { ...owner.blueprint, goals: owner.blueprint.goals.map(goal => ({ ...goal, title: "新的摄影目标", stages: goal.stages.map(stage => ({ ...stage,
    nodes: stage.nodes.map(node => ({ ...node, title: "改名后的节点", resources: [{ id: randomUUID(), kind: "youtube_video" as const, externalId: "lmnopqrstuv", url: "https://www.youtube.com/watch?v=lmnopqrstuv" }] })) })) })) };
  const replacement = await owner.apply(changed);
  expect(await recordLearningNote(owner.client, owner.actor, owner.input)).toEqual(first);
  expect(await recordLearningNote(owner.client, owner.actor, { ...owner.input, clientMutationId: randomUUID() })).toEqual({ ok: false, code: "version_conflict" });
  expect(await recordLearningNote(owner.client, owner.actor, { ...owner.input, expectedVersion: replacement.version, clientMutationId: randomUUID() })).toEqual({ ok: false, code: "not_found" });
  for (const changed of [{ text: "不同原文" }, { positionSeconds: 0 }, { resourceBindingId: randomUUID() }, { nodeId: randomUUID() }, { expectedVersion: 2 }]) {
    expect(await recordLearningNote(owner.client, owner.actor, { ...owner.input, ...changed })).toEqual({ ok: false, code: "invalid" });
  }
  const archived = await owner.apply({ ...replacement, goals: [] });
  expect(await recordLearningNote(owner.client, owner.actor, owner.input)).toEqual(first);
  expect(await readLearningNoteWorkspace(owner.client, owner.actor)).toEqual({ ok: true, value: { blueprint: archived, records: first.ok ? [first.value] : [] } });
});

it("two real accounts cannot read, forge or overwrite each other's notes", async () => {
  const owner = await fixture(), other = await fixture();
  const saved = await recordLearningNote(owner.client, owner.actor, owner.input); expect(saved.ok).toBe(true);
  expect(await readLearningNoteWorkspace(other.client, other.actor)).toEqual({ ok: true, value: { blueprint: other.blueprint, records: [] } });
  expect(await readLearningNoteWorkspace(other.client, owner.actor)).toEqual({ ok: false, code: "not_found" });
  expect(await recordLearningNote(other.client, other.actor, owner.input)).toEqual({ ok: false, code: "not_found" });
  expect((await other.client.from("learning_notes").select("id").eq("owner_id", owner.id)).data).toEqual([]);
  expect((await owner.client.from("learning_notes").insert({ owner_id: owner.id })).error?.code).toBe("42501");
  expect((await owner.client.from("learning_notes").update({ note_text: "overwrite" }).eq("owner_id", owner.id)).error?.code).toBe("42501");
});

it("nullable positions, zero, Unicode length and raw whitespace agree across domain and actual database", async () => {
  const owner = await fixture();
  for (const [positionSeconds, text] of [[null, "\n无时间点的笔记\t"], [0, "🙂".repeat(8000)], [2_147_483_647, "用户输入位置，不是已观看证明"]] as const) {
    const input = { ...owner.input, positionSeconds, text, clientMutationId: randomUUID() };
    const result = await recordLearningNote(owner.client, owner.actor, input);
    expect(result.ok).toBe(true); if (result.ok) expect(result.value).toMatchObject({ positionSeconds, text });
  }
  const workspace = await readLearningNoteWorkspace(owner.client, owner.actor);
  expect(workspace.ok && workspace.value.records).toHaveLength(3);
});
