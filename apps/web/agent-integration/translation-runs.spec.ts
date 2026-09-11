import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { transcriptFixture } from "../transcript-e2e/fixture";
import { createTranslationRunAccess } from "../src/lib/agent/translation-run-access";
import { createTranslationRunWorker } from "../src/lib/agent/translation-run-worker";
import { createTranscriptTranslator } from "../src/lib/agent/transcript-translator";
import { createPlanningModel } from "../src/lib/agent/planning-runtime";

function provisionFixtureQuota(ownerId: string) {
  if (!/^[a-f0-9-]{36}$/.test(ownerId)) throw new Error("Invalid fixture identity");
  execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: `insert into private.translation_run_quotas(owner_id,remaining) values('${ownerId}',1);`, stdio: ["pipe", "pipe", "pipe"] });
}

async function fixtureSkill() {
  const instructions = await readFile(new URL("../src/lib/agent/skills/translate-transcript/v1/SKILL.md", import.meta.url), "utf8");
  return { name: "blueprint-translate-transcript" as const, version: "1.0.0" as const, instructions, sha256: createHash("sha256").update(instructions).digest("hex") };
}

test("real Auth persists one claimed SDK translation, recovers without execution, and clears derived content with its original", async () => {
  const owner = await transcriptFixture();
  let other: Awaited<ReturnType<typeof transcriptFixture>> | undefined;
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") { response.writeHead(404); response.end(); return; }
    let body = ""; request.setEncoding("utf8"); request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      bodies.push(body); response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "local-durable-translation", object: "chat.completion", created: 0, model: "deepseek-v4-flash",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ segments: [{ segmentIndex: 20, translation: "用自己的照片解释你的选择。" }] }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 51, completion_tokens: 19, total_tokens: 70 } }));
    });
  });
  try {
    other = await transcriptFixture();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback port");
    const actor = { userId: owner.ownerId, client: "web" as const };
    const access = createTranslationRunAccess(owner.client, actor);
    const sourceRunId = await owner.acquire(), runId = randomUUID();
    const command = { runId, ...owner.command, sourceRunId, offset: 20, targetLanguage: "zh-Hans" };
    expect(await access.begin(command)).toEqual({ ok: false, code: "quota_exhausted" });
    provisionFixtureQuota(owner.ownerId);
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { id: runId, status: "queued", input_page: { offset: 20 }, skill: null, model: null } });
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { id: runId, status: "queued" } });
    expect(await createTranslationRunAccess(other.client, { userId: other.ownerId, client: "web" }).read(runId)).toEqual({ ok: false, code: "not_found" });

    const skill = await fixtureSkill();
    const worker = createTranslationRunWorker(owner.admin, owner.ownerId), leaseId = randomUUID();
    const sourceReadStartedAt = performance.now();
    const [claim, duplicate] = await Promise.all([
      worker.claim({ runId, leaseId, skill, model: "deepseek-v4-flash" }),
      worker.claim({ runId, leaseId, skill, model: "deepseek-v4-flash" }),
    ]);
    expect([claim, duplicate].filter(value => value.ok && value.acquired)).toHaveLength(1);
    const acquired = claim.ok && claim.acquired ? claim : duplicate;
    if (!acquired.ok || !acquired.acquired || !acquired.run.input_page) throw new Error("Translation not acquired");
    const model = createPlanningModel("fixture-key", async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://api.deepseek.com") throw new Error("Unexpected provider origin");
      return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
    });
    const result = await createTranscriptTranslator({ model }).run({ generationId: runId, ownerId: owner.ownerId, targetLanguage: "zh-Hans",
      request: { ...owner.command, sourceRunId, offset: 20 }, transcript: { ...acquired.run.input_page, observedAt: acquired.observedAt },
      sourceReadStartedAt, signal: new AbortController().signal, expectedSkillSha256: skill.sha256 });
    expect(result.status).toBe("translated");
    expect(await worker.finish({ runId, leaseId, result })).toMatchObject({ ok: true, run: { status: "ready",
      result: { status: "translated", usage: { inputTokens: 51, outputTokens: 19, totalTokens: 70 }, segments: [{ segmentIndex: 20, translation: "用自己的照片解释你的选择。" }] } } });
    expect(await worker.finish({ runId, leaseId, result })).toMatchObject({ ok: true, run: { status: "ready" } });
    const recovered = await createTranslationRunAccess(owner.client, actor).read(runId);
    expect(recovered).toMatchObject({ ok: true, run: { status: "ready", input_page: { segments: [{ text: "最后一段：用自己的照片解释你的选择。" }] } } });
    expect(await access.begin(command)).toEqual(recovered);
    expect(await access.begin({ ...command, runId: randomUUID() })).toEqual({ ok: false, code: "quota_exhausted" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain(owner.ownerId);
    expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: sourceRunId })).error).toBeNull();
    expect(await access.read(runId)).toMatchObject({ ok: true, run: { status: "cleared", input_page: null, result: null, skill: null, model: null } });
    expect(await worker.finish({ runId, leaseId, result })).toMatchObject({ ok: true, run: { status: "cleared", result: null } });
    const blueprint = await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.ownerId });
    expect(blueprint.data.version).toBe(1); expect(blueprint.data.goals[0].stages[0].nodes[0].resources[0].id).toBe(owner.bindingId);
  } finally {
    server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    try { await owner.cleanup(); } finally { await other?.cleanup(); }
  }
});

test("real caller cancellation refunds only an unclaimed run, never gives caller execution rights or replenishes a claimed run", async () => {
  const owner = await transcriptFixture();
  try {
    provisionFixtureQuota(owner.ownerId);
    const access = createTranslationRunAccess(owner.client, { userId: owner.ownerId, client: "web" });
    const command = { ...owner.command, sourceRunId: await owner.acquire(), offset: 0, targetLanguage: "zh-Hans", runId: randomUUID() };
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { status: "queued" } });
    expect(await access.cancel(command.runId)).toMatchObject({ ok: true, run: { status: "cancelled", result: { providerMayHaveRun: false } } });
    expect(await access.cancel(command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
    const second = { ...command, runId: randomUUID() };
    expect(await access.begin(second)).toMatchObject({ ok: true, run: { status: "queued" } });
    const claim = { runId: second.runId, leaseId: randomUUID(), skill: await fixtureSkill(), model: "deepseek-v4-flash" };
    expect(await createTranslationRunWorker(owner.client, owner.ownerId).claim(claim)).toEqual({ ok: false, code: "forbidden" });
    const worker = createTranslationRunWorker(owner.admin, owner.ownerId);
    expect(await worker.claim(claim)).toMatchObject({ ok: true, acquired: true });
    expect(await access.cancel(second.runId)).toMatchObject({ ok: true, run: { status: "cancelled", result: { providerMayHaveRun: true } } });
    expect(await worker.finish({ runId: second.runId, leaseId: randomUUID(), result: { status: "unavailable", providerMayHaveRun: true, usage: null } })).toEqual({ ok: false, code: "forbidden" });
    expect(await access.begin({ ...command, runId: randomUUID() })).toEqual({ ok: false, code: "quota_exhausted" });
  } finally { await owner.cleanup(); }
});

test("a real source deadline clears the queued translation and its old ID never creates new content", async () => {
  const owner = await transcriptFixture();
  try {
    provisionFixtureQuota(owner.ownerId);
    const access = createTranslationRunAccess(owner.client, { userId: owner.ownerId, client: "web" });
    const command = { ...owner.command, sourceRunId: await owner.acquire(3), offset: 20, targetLanguage: "zh-Hans", runId: randomUUID() };
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { status: "queued" } });
    await new Promise(resolve => setTimeout(resolve, 3300));
    expect(await access.read(command.runId)).toMatchObject({ ok: true, run: { status: "cleared", clear_reason: "expired", result: null, input_page: null } });
    expect(await access.begin(command)).toMatchObject({ ok: true, run: { status: "cleared", result: null } });
    expect(await access.begin({ ...command, runId: randomUUID(), sourceRunId: await owner.acquire() })).toMatchObject({ ok: true, run: { status: "queued" } });
  } finally { await owner.cleanup(); }
});
