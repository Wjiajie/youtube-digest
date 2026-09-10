import { afterEach, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createClarificationAccess } from "../src/lib/agent/clarification-access";
import { createCloudGoalClarifier } from "../src/lib/agent/cloud-goal-clarifier";
import { createClarificationWorker } from "../src/lib/agent/clarification-runtime";
import { createPlanningModel } from "../src/lib/agent/planning-runtime";
import { loadClarificationSkill } from "../src/lib/agent/clarification-skill";
import { readGoalBrief } from "../src/lib/goal-briefs";

const local = localSupabaseTestConfig();
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth });
const workerKey = "local-only-clarification-worker-fixture-secret-32";
const accounts: Array<{ id: string; client: SupabaseClient }> = [];
it("returns 413 for a multibyte overflow before identity or database work", async () => {
  const headers = { "content-type": "application/json", apikey: local.PUBLISHABLE_KEY,
    authorization: "Bearer a.b.c", "x-blueprint-worker-secret": workerKey };
  for (let i = 0; i < 3; i++) await (await fetch(`${local.API_URL}/functions/v1/clarification-worker`, {
    method: "POST", headers, body: "{}", signal: AbortSignal.timeout(5_000),
  })).text();
  const response = await fetch(`${local.API_URL}/functions/v1/clarification-worker`, {
    method: "POST", headers, body: JSON.stringify({ padding: "中".repeat(400_000) }), signal: AbortSignal.timeout(5_000),
  });
  expect(response.status).toBe(413);
});
afterEach(async () => {
  const cleanup = await Promise.allSettled(accounts.splice(0).map(async ({ id, client }) => {
    const signedOut = await client.auth.signOut();
    const deleted = await admin.auth.admin.deleteUser(id);
    expect(signedOut.error?.code ?? null).toBeNull(); expect(deleted.error?.code ?? null).toBeNull();
  }));
  expect(cleanup.every(item => item.status === "fulfilled")).toBe(true);
});
async function fixture() {
  const id = randomUUID(), email = `${id}@clarification-edge.example.test`, password = randomUUID();
  const created = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
  expect(created.error?.code ?? null).toBeNull();
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth });
  accounts.push({ id, client });
  const login = await client.auth.signInWithPassword({ email, password });
  expect(login.error?.code ?? null).toBeNull();
  if (!login.data.session) throw new Error("Local session unavailable");
  for (let attempt = 0; attempt < 6; attempt++) {
    const probe = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
    if (!probe.error) break;
    if (probe.error.code !== "PGRST303" || attempt === 5) throw new Error("Local database read unavailable");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const actor = { userId: id, client: "web" as const }, briefId = randomUUID(), sessionId = randomUUID();
  const saved = await client.rpc("save_goal_brief", { p_id: briefId, p_expected_revision: 0, p_confirm: false, p_client_mutation_id: randomUUID(),
    p_content: { schemaVersion: 1, outcome: "摄影作品", startingPoint: "", weeklyMinutes: null, targetDate: null, constraints: "", successCriteria: "" } });
  expect(saved.error?.code ?? null).toBeNull();
  const access = createClarificationAccess(client, actor);
  expect((await access.create({ sessionId, briefId, expectedBriefRevision: 1 })).ok).toBe(true);
  execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `insert into private.goal_clarification_quotas(owner_id,available_attempts) values ('${id}',2);`, stdio: ["pipe", "pipe", "pipe"],
  });
  const token = login.data.session.access_token;
  const worker = createClarificationWorker({ url: local.API_URL, publishableKey: local.PUBLISHABLE_KEY,
    apiKey: "clarification-edge-provider-fixture", workerKey }, token);
  return { id, actor, client, briefId, sessionId, access, token, worker };
}

it("recovers a lost completion response across actual Edge, Auth, database and DeepSeek SDK before explicit checkpoint", async () => {
  const owner = await fixture(); let calls = 0, lostResponse = false;
  const worker = createClarificationWorker({ url: local.API_URL, publishableKey: local.PUBLISHABLE_KEY,
    apiKey: "clarification-edge-provider-fixture", workerKey }, owner.token, async (url, options) => {
    const response = await fetch(url, options);
    if (JSON.parse(String(options?.body)).operation === "finish" && !lostResponse) {
      expect(response.status).toBe(200); await response.text(); lostResponse = true;
      throw new TypeError("Simulated network loss after actual persistence");
    }
    return response;
  });
  const model = createPlanningModel("clarification-edge-provider-fixture", async (url, options) => {
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(options?.body)).model).toBe("deepseek-v4-flash"); calls++;
    return Response.json({ id: "local-clarification", object: "chat.completion", created: 0, model: "deepseek-v4-flash",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({
        reflection: "你已经明确了起点和每周可投入的时间。", changes: [
          { field: "startingPoint", value: "新手", quote: "新手" }, { field: "weeklyMinutes", value: 180, quote: "每周三小时" }],
        question: { field: "successCriteria", text: "你希望完成怎样的摄影作品？" }, concerns: [], pause: null,
      }) } }], usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 } });
  });
  const clarifier = createCloudGoalClarifier({ client: owner.client, actor: owner.actor, worker, model });
  const command = { turnId: randomUUID(), sessionId: owner.sessionId, expectedRevision: 1, message: "我是新手，每周三小时。" };
  const result = await clarifier.run(command, new AbortController().signal);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(result.value).toMatchObject({ status: "ready", result: { status: "needs_input", content: { weeklyMinutes: 180 } } });
  expect(await owner.access.readTurn(command.turnId)).toEqual(result);
  expect(await clarifier.run(command, new AbortController().signal)).toEqual(result);
  expect(calls).toBe(1);
  expect(lostResponse).toBe(true);
  expect(await readGoalBrief(owner.client, owner.actor, owner.briefId)).toMatchObject({ ok: true, value: { revision: 1, content: { weeklyMinutes: null } } });
  expect(await owner.access.save({ sessionId: owner.sessionId, expectedRevision: 2, confirm: false, clientMutationId: randomUUID() }))
    .toMatchObject({ ok: true, value: { session: { status: "closed" }, brief: { revision: 2, status: "draft", content: { weeklyMinutes: 180 } } } });
});

it("rejects wrong credentials, forged JWTs, owner injection, oversized requests and cross-owner claims over actual HTTP", async () => {
  const owner = await fixture(), outsider = await fixture(), turnId = randomUUID(), leaseId = randomUUID();
  const loaded = await loadClarificationSkill(), skill = { ...loaded.identity, instructions: loaded.instructions };
  const began = await owner.client.rpc("begin_goal_clarification", { p_turn_id: turnId, p_session_id: owner.sessionId, p_expected_revision: 1, p_message: "继续" });
  expect(began.error?.code ?? null).toBeNull();
  const payload = { operation: "claim", turnId, leaseId, skill };
  const headers = { "content-type": "application/json", apikey: local.PUBLISHABLE_KEY,
    authorization: `Bearer ${owner.token}`, "x-blueprint-worker-secret": workerKey };
  async function post(body: unknown, extra: Record<string, string> = {}) {
    return fetch(`${local.API_URL}/functions/v1/clarification-worker`, { method: "POST", headers: { ...headers, ...extra },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  }
  expect((await post(payload, { "x-blueprint-worker-secret": "wrong" })).status).toBe(403);
  const parts = owner.token.split("."); parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
  expect((await post(payload, { authorization: `Bearer ${parts.join(".")}` })).status).toBe(401);
  expect((await post({ ...payload, ownerId: owner.id })).status).toBe(422);
  expect((await post({ ...payload, padding: "中".repeat(400_000) })).status).toBe(413);
  expect((await post(payload, { authorization: `Bearer ${outsider.token}` })).status).toBe(404);
  expect(await owner.access.readTurn(turnId)).toMatchObject({ ok: true, value: { status: "queued" } });
  expect((await owner.access.cancelTurn(turnId)).ok).toBe(true);
});
