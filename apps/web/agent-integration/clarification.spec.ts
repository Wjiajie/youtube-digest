import { afterEach, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { MockLanguageModelV4 } from "ai/test";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createClarificationAccess } from "../src/lib/agent/clarification-access";
import { readGoalBrief } from "../src/lib/goal-briefs";
import { createCloudGoalClarifier } from "../src/lib/agent/cloud-goal-clarifier";
import type { ClarificationWorker } from "../src/lib/agent/clarification-worker";

const local = localSupabaseTestConfig();
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth });
const accounts: Array<{ id: string; client: SupabaseClient }> = [];
function localSql(sql: string) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
// Test adapter across the actual DB boundary; application code uses verified Edge HTTP instead.
function databaseWorker(ownerId: string): ClarificationWorker {
  return { claim: async input => await admin.rpc("claim_goal_clarification", { p_owner_id: ownerId, p_turn_id: input.turnId,
    p_lease_id: input.leaseId, p_skill: input.skill }),
  finish: async input => await admin.rpc("finish_goal_clarification", { p_owner_id: ownerId, p_turn_id: input.turnId,
    p_lease_id: input.leaseId, p_result: input.result }) };
}
function providerReply(value: unknown): Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>> {
  return { content: [{ type: "text", text: JSON.stringify(value) }], finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 40, text: 40, reasoning: undefined } }, warnings: [] };
}
const followUp = () => ({ reflection: "先了解你的实际起点。", changes: [],
  question: { field: "startingPoint", text: "你现在可以独立完成什么？" }, concerns: [], pause: null });
async function start(owner: Awaited<ReturnType<typeof fixture>>, credits: number) {
  const sessionId = randomUUID();
  expect((await owner.access.create({ sessionId, briefId: owner.briefId, expectedBriefRevision: 1 })).ok).toBe(true);
  localSql(`insert into private.goal_clarification_quotas(owner_id,available_attempts) values ('${owner.id}',${credits});`);
  return { turnId: randomUUID(), sessionId, expectedRevision: 1, message: "我想继续梳理摄影目标。" };
}
afterEach(async () => {
  const results = await Promise.allSettled(accounts.splice(0).map(async ({ id, client }) => {
    const signedOut = await client.auth.signOut();
    const removed = await admin.auth.admin.deleteUser(id);
    expect(signedOut.error?.code ?? null).toBeNull(); expect(removed.error?.code ?? null).toBeNull();
  }));
  expect(results.every(result => result.status === "fulfilled")).toBe(true);
});
async function fixture() {
  const id = randomUUID(), email = `${id}@clarification-run.example.test`, password = randomUUID();
  const created = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
  expect(created.error?.code ?? null).toBeNull();
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth });
  accounts.push({ id, client });
  expect((await client.auth.signInWithPassword({ email, password })).error?.code ?? null).toBeNull();
  for (let attempt = 0; attempt < 6; attempt++) {
    const probe = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
    if (!probe.error) break;
    if (probe.error.code !== "PGRST303" || attempt === 5) throw new Error(`Local read unavailable: ${probe.error.code}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const briefId = randomUUID();
  const saved = await client.rpc("save_goal_brief", { p_id: briefId, p_expected_revision: 0, p_confirm: false, p_client_mutation_id: randomUUID(),
    p_content: { schemaVersion: 1, outcome: "想学摄影", startingPoint: "", weeklyMinutes: null, targetDate: null, constraints: "", successCriteria: "" } });
  expect(saved.error?.code ?? null).toBeNull();
  const actor = { userId: id, client: "web" as const };
  return { id, client, briefId, actor, access: createClarificationAccess(client, actor) };
}

it("persists a separate working suggestion, then saves a Goal Brief only on explicit user confirmation", async () => {
  const owner = await fixture();
  const command = { sessionId: randomUUID(), briefId: owner.briefId, expectedBriefRevision: 1 };
  const started = await owner.access.create(command);
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error(started.code);
  expect(await owner.access.read(command.sessionId)).toEqual(started);
  const content = { ...started.value.content, outcome: "  完成家庭摄影集  ", startingPoint: "会使用自动档", weeklyMinutes: 180,
    successCriteria: "拍摄六张照片并记录家人反馈" };
  const edit = { sessionId: command.sessionId, expectedRevision: 1, content, clientMutationId: randomUUID() };
  const edited = await owner.access.edit(edit);
  expect(edited.ok).toBe(true);
  if (!edited.ok) throw new Error(edited.code);
  expect(edited.value.revision).toBe(2);
  expect(edited.value.content).toEqual(content);
  expect(await owner.access.edit(edit)).toEqual(edited);
  const before = await readGoalBrief(owner.client, owner.actor, owner.briefId);
  expect(before).toMatchObject({ ok: true, value: { revision: 1, status: "draft", content: { outcome: "想学摄影" } } });
  const save = { sessionId: command.sessionId, expectedRevision: 2, confirm: true, clientMutationId: randomUUID() };
  const saved = await owner.access.save(save);
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error(saved.code);
  expect(saved.value.session.status).toBe("closed");
  expect(saved.value.brief).toMatchObject({ id: owner.briefId, revision: 2, status: "confirmed", content });
  expect(await owner.access.save(save)).toEqual(saved);
  const blueprint = await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.id });
  expect(blueprint.data).toMatchObject({ version: 0, goals: [] });
});

it("recovers two real durable turns, preserves actual question-answer history and requires explicit confirmation", async () => {
  const owner = await fixture(), sessionId = randomUUID();
  expect((await owner.access.create({ sessionId, briefId: owner.briefId, expectedBriefRevision: 1 })).ok).toBe(true);
  localSql(`insert into private.goal_clarification_quotas(owner_id,available_attempts) values ('${owner.id}',3);`);
  const model = new MockLanguageModelV4({ doGenerate: [providerReply({ reflection: "你有稳定的每周投入时间。",
    changes: [{ field: "startingPoint", value: "新手", quote: "新手" }, { field: "weeklyMinutes", value: 180, quote: "每周有三小时" }],
    question: { field: "successCriteria", text: "你会如何判断学有所获？" }, concerns: [], pause: null }),
  providerReply({ reflection: "你希望用家人的具体反馈来检查照片。", changes: [
    { field: "outcome", value: "完成六张家庭照片", quote: "完成六张家庭照片" },
    { field: "successCriteria", value: "请家人评价构图", quote: "请家人评价构图" }], question: null, concerns: [], pause: null })] });
  const clarifier = createCloudGoalClarifier({ client: owner.client, actor: owner.actor, worker: databaseWorker(owner.id), model });
  const firstCommand = { turnId: randomUUID(), sessionId, expectedRevision: 1, message: "我是新手，每周有三小时。" };
  const first = await clarifier.run(firstCommand, new AbortController().signal);
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.code);
  expect(first.value).toMatchObject({ status: "ready", result: { status: "needs_input", content: { weeklyMinutes: 180 } } });
  expect(await owner.access.readTurn(firstCommand.turnId)).toEqual(first);
  expect(await clarifier.run(firstCommand, new AbortController().signal)).toEqual(first);
  const secondCommand = { turnId: randomUUID(), sessionId, expectedRevision: 2, message: "完成六张家庭照片，请家人评价构图。" };
  const second = await clarifier.run(secondCommand, new AbortController().signal);
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.code);
  expect(second.value).toMatchObject({ status: "ready", inputQuestion: "你会如何判断学有所获？",
    history: [{ question: "你希望实现什么目标？", answer: firstCommand.message }],
    result: { status: "reviewable", content: { startingPoint: "新手", weeklyMinutes: 180 }, source: { briefRevision: 1 } } });
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(await readGoalBrief(owner.client, owner.actor, owner.briefId)).toMatchObject({ ok: true, value: { revision: 1, status: "draft" } });
  const saved = await owner.access.save({ sessionId, expectedRevision: 3, confirm: true, clientMutationId: randomUUID() });
  expect(saved).toMatchObject({ ok: true, value: { brief: { revision: 2, status: "confirmed", content: { outcome: "完成六张家庭照片" } } } });
});

it("deduplicates concurrent sends, rejects overlapping edits and discards a cancelled late answer", async () => {
  const owner = await fixture(), command = await start(owner, 2);
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>>();
  const model = new MockLanguageModelV4({ doGenerate: async () => { started.resolve(); return response.promise; } });
  const clarifier = createCloudGoalClarifier({ client: owner.client, actor: owner.actor, worker: databaseWorker(owner.id), model });
  const running = clarifier.run(command, new AbortController().signal);
  await started.promise;
  try {
    expect(await clarifier.run(command, new AbortController().signal)).toMatchObject({ ok: true, value: { status: "running" } });
    expect(await clarifier.run({ ...command, turnId: randomUUID() }, new AbortController().signal)).toEqual({ ok: false, code: "busy" });
    const session = await owner.access.read(command.sessionId);
    if (!session.ok) throw new Error(session.code);
    expect(await owner.access.edit({ sessionId: command.sessionId, expectedRevision: 1, content: session.value.content, clientMutationId: randomUUID() }))
      .toEqual({ ok: false, code: "busy" });
    expect(await owner.access.cancelTurn(command.turnId)).toMatchObject({ ok: true, value: { status: "cancelled", result: { providerMayHaveRun: true } } });
  } finally { response.resolve(providerReply(followUp())); }
  expect(await running).toMatchObject({ ok: true, value: { status: "cancelled" } });
  expect(await owner.access.read(command.sessionId)).toMatchObject({ ok: true, value: { revision: 1, content: { outcome: "想学摄影" } } });
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(localSql(`select available_attempts from private.goal_clarification_quotas where owner_id='${owner.id}'`)).toBe("1");
});

it("does not spend on zero allowance or a caller-provided model/stage, and protects other owners", async () => {
  const owner = await fixture(), outsider = await fixture(), command = await start(owner, 0);
  const model = new MockLanguageModelV4();
  const clarifier = createCloudGoalClarifier({ client: owner.client, actor: owner.actor, worker: databaseWorker(owner.id), model });
  expect(await clarifier.run(command, new AbortController().signal)).toEqual({ ok: false, code: "quota_exhausted" });
  expect(await clarifier.run({ ...command, model: "unapproved" }, new AbortController().signal)).toEqual({ ok: false, code: "invalid" });
  expect(await outsider.access.read(command.sessionId)).toEqual({ ok: false, code: "not_found" });
  expect(await outsider.access.edit({ sessionId: command.sessionId, expectedRevision: 1,
    content: { schemaVersion: 1, outcome: "replace", startingPoint: "", weeklyMinutes: null, targetDate: null, constraints: "", successCriteria: "" },
    clientMutationId: randomUUID() })).toEqual({ ok: false, code: "not_found" });
  expect(model.doGenerateCalls).toHaveLength(0);
});

it("marks a session stale after direct source editing and never applies an already-running answer", async () => {
  const owner = await fixture(), command = await start(owner, 1);
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    const updated = await owner.client.rpc("save_goal_brief", { p_id: owner.briefId, p_expected_revision: 1, p_confirm: false,
      p_client_mutation_id: randomUUID(), p_content: { schemaVersion: 1, outcome: "用户改成绘画目标", startingPoint: "", weeklyMinutes: null,
        targetDate: null, constraints: "", successCriteria: "" } });
    expect(updated.error?.code ?? null).toBeNull();
    return providerReply(followUp());
  } });
  const clarifier = createCloudGoalClarifier({ client: owner.client, actor: owner.actor, worker: databaseWorker(owner.id), model });
  expect(await clarifier.run(command, new AbortController().signal)).toMatchObject({ ok: true, value: { status: "stale" } });
  expect(await owner.access.read(command.sessionId)).toMatchObject({ ok: true, value: { status: "stale", revision: 1 } });
  expect(await owner.access.save({ sessionId: command.sessionId, expectedRevision: 1, confirm: false, clientMutationId: randomUUID() }))
    .toEqual({ ok: false, code: "version_conflict" });
  expect(await readGoalBrief(owner.client, owner.actor, owner.briefId)).toMatchObject({ ok: true, value: { revision: 2, content: { outcome: "用户改成绘画目标" } } });
});

it("lists only the owner's recovery sessions and turns with bounded pagination", async () => {
  const owner = await fixture(), outsider = await fixture(), command = await start(owner, 1);
  const clarifier = createCloudGoalClarifier({ client: owner.client, actor: owner.actor, worker: databaseWorker(owner.id),
    model: new MockLanguageModelV4({ doGenerate: providerReply(followUp()) }) });
  expect((await clarifier.run(command, new AbortController().signal)).ok).toBe(true);
  expect(await owner.access.list(owner.briefId)).toMatchObject({ ok: true, value: { items: [{ id: command.sessionId }], hasMore: false } });
  expect(await owner.access.listTurns(command.sessionId)).toMatchObject({ ok: true, value: { items: [{ id: command.turnId, ordinal: 1, status: "ready" }], hasMore: false } });
  expect(await outsider.access.list(owner.briefId)).toEqual({ ok: true, value: { items: [], hasMore: false } });
  expect(await outsider.access.listTurns(command.sessionId)).toEqual({ ok: true, value: { items: [], hasMore: false } });
  expect(await owner.access.list(owner.briefId, -1)).toEqual({ ok: false, code: "invalid" });
  expect(await owner.access.listTurns(command.sessionId, 1_000_001)).toEqual({ ok: false, code: "invalid" });
});
