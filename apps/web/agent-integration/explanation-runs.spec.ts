import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { transcriptFixture } from "../transcript-e2e/fixture";
import { createExplanationRunAccess } from "../src/lib/agent/explanation-run-access";
import { createExplanationRunWorker } from "../src/lib/agent/explanation-run-worker";
import { createCaptionExplainer } from "../src/lib/agent/caption-explainer";
import { createPlanningModel } from "../src/lib/agent/planning-runtime";

function provisionFixtureQuota(ownerId: string) {
  if (!/^[a-f0-9-]{36}$/.test(ownerId)) throw new Error("Invalid fixture identity");
  execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `insert into private.explanation_run_quotas(owner_id,remaining) values('${ownerId}',1);`, stdio: ["pipe", "pipe", "pipe"], timeout: 15000,
  });
}

async function fixtureSkill() {
  const instructions = await readFile(new URL("../src/lib/agent/skills/explain-selection/v1/SKILL.md", import.meta.url), "utf8");
  return { name: "blueprint-explain-selection" as const, version: "1.0.0" as const, instructions, sha256: createHash("sha256").update(instructions).digest("hex") };
}

const selection = { start: { segmentIndex: 20, charOffset: 5 }, end: { segmentIndex: 20, charOffset: 17 } };
const explanation = { kind: "explanation", meaning: "用自己的照片表达和解释选择。", reasoning: "原文要求用自己的照片解释，不是单纯观看示范。",
  background: null, checkQuestion: "你能用哪张自己的照片说明选择？", limitations: ["当前片段没有给出具体拍摄参数。"], evidence: [{ segmentIndex: 20, quote: "自己的照片" }] };

test.each([
  { status: "explained", answer: explanation },
  { status: "insufficient_context", answer: { kind: "insufficient_context", reason: "片段没有说明拍摄参数。", missingContext: ["拍摄时的实际光线条件。"] } },
])("real Auth persists one claimed SDK $status answer, recovers its frozen selection, and clears it with its source", async ({ status, answer }) => {
  const owner = await transcriptFixture(), requests: string[] = [];
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions" || request.headers.authorization !== "Bearer local-explanation-fixture") {
      response.writeHead(404); response.end(); return;
    }
    let body = ""; request.setEncoding("utf8"); request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      requests.push(body); response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "local-durable-explanation", object: "chat.completion", created: 0, model: "deepseek-flash",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 51, completion_tokens: 19, total_tokens: 70 } }));
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback port");
    const actor = { userId: owner.ownerId, client: "web" as const }, access = createExplanationRunAccess(owner.client, actor);
    const runId = randomUUID(), sourceRunId = await owner.acquire();
    const command = { ...owner.command, sourceRunId, runId, offset: 20, targetLanguage: "zh-Hans", selection, question: "怎样练习？" };
    expect(await access.begin(command)).toEqual({ ok: false, code: "quota_exhausted" });
    provisionFixtureQuota(owner.ownerId);
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { id: runId, status: "queued", selection, question: "怎样练习？", skill: null, model: null } });
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { id: runId, status: "queued" } });
    const skill = await fixtureSkill(), worker = createExplanationRunWorker(owner.admin, owner.ownerId), leaseId = randomUUID();
    const sourceReadStartedAt = performance.now();
    const claims = await Promise.all([worker.claim({ runId, leaseId, skill, model: "deepseek-flash" }), worker.claim({ runId, leaseId, skill, model: "deepseek-flash" })]);
    expect(claims.filter(value => value.ok && value.acquired)).toHaveLength(1);
    const acquired = claims.find(value => value.ok && value.acquired);
    if (!acquired?.ok || !acquired.acquired || !acquired.run.input_page) throw new Error("Explanation not acquired");
    const model = createPlanningModel("local-explanation-fixture", (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://api.deepseek.com" || url.pathname !== "/chat/completions") throw new Error("Unexpected provider endpoint");
      return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
    });
    const result = await createCaptionExplainer({ model }).run({ generationId: runId, ownerId: owner.ownerId,
      request: { ...owner.command, sourceRunId, offset: 20 }, transcript: { ...acquired.run.input_page, observedAt: acquired.observedAt },
      selection: acquired.run.selection, question: acquired.run.question, sourceReadStartedAt, signal: new AbortController().signal, expectedSkillSha256: skill.sha256 });
    expect(result).toMatchObject({ status, selected: [{ text: "用自己的照片解释你的选择", offsetMs: 300000, durationMs: 10000 }] });
    const completion = { runId, leaseId, run: acquired.run, result };
    expect(await worker.finish(completion)).toMatchObject({ ok: true, run: { status: "ready", result: { status, answer,
      usage: { inputTokens: 51, outputTokens: 19, totalTokens: 70 } } } });
    const recovered = await createExplanationRunAccess(owner.client, actor).read(runId);
    expect(await worker.finish(completion)).toEqual(recovered);
    expect(await access.begin(command)).toEqual(recovered);
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toContain(owner.ownerId); expect(requests[0]).not.toContain("用影像讲述生活");
    expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: sourceRunId })).error).toBeNull();
    expect(await access.read(runId)).toMatchObject({ ok: true, run: { status: "cleared", input_page: null, selection: null, question: null, result: null, skill: null, model: null } });
    expect(await worker.finish(completion)).toMatchObject({ ok: true, run: { status: "cleared", result: null } });
    const blueprint = await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.ownerId });
    expect(blueprint.data.version).toBe(1); expect(blueprint.data.goals[0].stages[0].nodes[0].resources[0].id).toBe(owner.bindingId);
  } finally {
    server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await owner.cleanup();
  }
});

test.each(["expiry", "manual"])("real source %s removes queued explanation content, refunds once, and preserves recovery identity", async action => {
  const owner = await transcriptFixture();
  try {
    provisionFixtureQuota(owner.ownerId);
    const access = createExplanationRunAccess(owner.client, { userId: owner.ownerId, client: "web" });
    const request = { ...owner.command, sourceRunId: await owner.acquire(action === "expiry" ? 3 : 600), offset: 20, targetLanguage: "zh-Hans", selection, question: "" };
    const runId = randomUUID();
    expect(await access.begin({ ...request, runId })).toMatchObject({ ok: true, run: { status: "queued" } });
    if (action === "expiry") await new Promise(resolve => setTimeout(resolve, 3300));
    else expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: request.sourceRunId })).error).toBeNull();
    expect(await access.read(runId)).toMatchObject({ ok: true, run: { status: "cleared", clear_reason: action === "expiry" ? "expired" : "manual",
      input_page: null, selection: null, question: null, result: null, skill: null, model: null } });
    expect(await access.begin({ ...request, runId })).toMatchObject({ ok: true, run: { status: "cleared", result: null } });
    expect(await access.find(request)).toEqual({ ok: true, runId });
    expect(await access.cancel(runId)).toMatchObject({ ok: true, run: { status: "cleared" } });
    const next = { ...request, sourceRunId: await owner.acquire(), runId: randomUUID() };
    expect(await access.begin(next)).toMatchObject({ ok: true, run: { status: "queued" } });
    const worker = createExplanationRunWorker(owner.admin, owner.ownerId);
    expect(await worker.claim({ runId: next.runId, leaseId: randomUUID(), skill: await fixtureSkill(), model: "deepseek-flash" })).toMatchObject({ ok: true, acquired: true });
    expect(await access.cancel(next.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
    expect(await access.begin({ ...next, runId: randomUUID() })).toEqual({ ok: false, code: "quota_exhausted" });
  } finally { await owner.cleanup(); }
});

test("real caller cancellation refunds only an unclaimed explanation and never grants inference rights", async () => {
  const owner = await transcriptFixture();
  try {
    provisionFixtureQuota(owner.ownerId);
    const access = createExplanationRunAccess(owner.client, { userId: owner.ownerId, client: "web" });
    const command = { ...owner.command, sourceRunId: await owner.acquire(), offset: 20, targetLanguage: "zh-Hans", selection, question: "", runId: randomUUID() };
    expect(await access.begin({ ...command, selection: { ...selection, end: { segmentIndex: 20, charOffset: 50 } } })).toEqual({ ok: false, code: "invalid" });
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { status: "queued" } });
    expect(await access.begin({ ...command, runId: randomUUID() })).toEqual({ ok: false, code: "busy" });
    expect(await access.cancel(command.runId)).toMatchObject({ ok: true, run: { status: "cancelled", result: { providerMayHaveRun: false } } });
    expect(await access.cancel(command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
    const second = { ...command, runId: randomUUID() };
    expect(await access.begin(second)).toMatchObject({ ok: true, run: { status: "queued" } });
    const claim = { runId: second.runId, leaseId: randomUUID(), skill: await fixtureSkill(), model: "deepseek-flash" };
    expect(await createExplanationRunWorker(owner.client, owner.ownerId).claim(claim)).toEqual({ ok: false, code: "forbidden" });
    const worker = createExplanationRunWorker(owner.admin, owner.ownerId), acquired = await worker.claim(claim);
    expect(acquired).toMatchObject({ ok: true, acquired: true });
    if (!acquired.ok || !acquired.acquired) throw new Error("Explanation not acquired");
    const result = { status: "unavailable" as const, providerMayHaveRun: true, usage: null };
    expect(await createExplanationRunWorker(owner.client, owner.ownerId).finish({ ...claim, run: acquired.run, result })).toEqual({ ok: false, code: "forbidden" });
    expect(await access.cancel(second.runId)).toMatchObject({ ok: true, run: { status: "cancelled", result: { providerMayHaveRun: true } } });
    expect(await worker.finish({ ...claim, leaseId: randomUUID(), run: acquired.run, result })).toEqual({ ok: false, code: "forbidden" });
    expect(await worker.finish({ ...claim, run: acquired.run, result })).toMatchObject({ ok: true, run: { status: "cancelled", result: { status: "cancelled" } } });
    expect(await access.begin({ ...command, runId: randomUUID() })).toEqual({ ok: false, code: "quota_exhausted" });
  } finally { await owner.cleanup(); }
});

test("a fresh real account session finds only its exact selection and question, including after content clearing", async () => {
  const owner = await transcriptFixture();
  let other: Awaited<ReturnType<typeof transcriptFixture>> | undefined;
  const session = createClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    other = await transcriptFixture();
    const access = createExplanationRunAccess(owner.client, { userId: owner.ownerId, client: "web" });
    const outsider = createExplanationRunAccess(other.client, { userId: other.ownerId, client: "web" });
    const request = { ...owner.command, sourceRunId: await owner.acquire(), offset: 20, targetLanguage: "zh-Hans", selection, question: "怎样练习？" };
    expect(await access.find(request)).toEqual({ ok: true, runId: null });
    provisionFixtureQuota(owner.ownerId);
    const first = randomUUID(), latest = randomUUID();
    expect(await access.begin({ ...request, runId: first })).toMatchObject({ ok: true, run: { status: "queued" } });
    expect(await access.begin({ ...request, runId: first, question: "为什么？" })).toEqual({ ok: false, code: "invalid" });
    expect(await access.begin({ ...request, runId: first, selection: { ...selection, end: { segmentIndex: 20, charOffset: 16 } } })).toEqual({ ok: false, code: "invalid" });
    expect(await access.cancel(first)).toMatchObject({ ok: true, run: { status: "cancelled" } });
    expect(await access.begin({ ...request, runId: latest })).toMatchObject({ ok: true, run: { status: "queued" } });
    expect(await access.cancel(latest)).toMatchObject({ ok: true, run: { status: "cancelled" } });
    expect((await session.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
    const fresh = createExplanationRunAccess(session, { userId: owner.ownerId, client: "web" });
    expect(await fresh.find(request)).toEqual({ ok: true, runId: latest });
    expect(await fresh.find({ ...request, bindingId: request.bindingId.toUpperCase(), sourceRunId: request.sourceRunId.toUpperCase() })).toEqual({ ok: true, runId: latest });
    expect(await fresh.find({ ...request, question: "怎样练习？ " })).toEqual({ ok: true, runId: null });
    expect(await fresh.find({ ...request, selection: { ...selection, end: { segmentIndex: 20, charOffset: 16 } } })).toEqual({ ok: true, runId: null });
    expect(await outsider.find(request)).toEqual({ ok: true, runId: null });
    expect(await outsider.read(latest)).toEqual({ ok: false, code: "not_found" });
    expect(await outsider.cancel(latest)).toEqual({ ok: false, code: "not_found" });
    expect(await outsider.begin({ ...request, runId: latest })).toEqual({ ok: false, code: "not_found" });
    expect((await session.rpc("find_explanation_run", { p_request: { ...request, ownerId: owner.ownerId } })).error?.code).toBe("22023");
    expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: request.sourceRunId })).error).toBeNull();
    expect(await fresh.find(request)).toEqual({ ok: true, runId: latest });
    expect(await fresh.read(latest)).toMatchObject({ ok: true, run: { status: "cleared", question: null, selection: null, input_page: null, result: null } });
    expect(await fresh.begin({ ...request, runId: latest })).toMatchObject({ ok: true, run: { status: "cleared" } });
    expect(await fresh.begin({ ...request, runId: latest, question: "不同的问题" })).toEqual({ ok: false, code: "invalid" });
  } finally {
    await session.auth.signOut();
    try { await owner.cleanup(); } finally { await other?.cleanup(); }
  }
});
