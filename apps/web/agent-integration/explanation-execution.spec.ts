import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { transcriptFixture } from "../transcript-e2e/fixture";
import { createPlanningModel } from "../src/lib/agent/planning-runtime";
import { createCloudExplanationRunner } from "../src/lib/agent/cloud-explanation-runner";
import { createRemoteExplanationWorker } from "../src/lib/agent/explanation-runtime";
import { createExplanationWorker } from "../../../supabase/functions/explanation-worker/handler";

const answer = { kind: "explanation", meaning: "用自己的照片表达和解释选择。", reasoning: "原文要求用自己的照片解释，不是单纯观看示范。",
  background: null, checkQuestion: "你能用哪张自己的照片说明选择？", limitations: ["当前片段没有给出具体拍摄参数。"], evidence: [{ segmentIndex: 20, quote: "自己的照片" }] };
const selection = { start: { segmentIndex: 20, charOffset: 5 }, end: { segmentIndex: 20, charOffset: 17 } };

function provisionFixtureQuota(ownerId: string) {
  if (!/^[a-f0-9-]{36}$/.test(ownerId)) throw new Error("Invalid fixture identity");
  execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `insert into private.explanation_run_quotas(owner_id,remaining) values('${ownerId}',1);`, stdio: ["pipe", "pipe", "pipe"], timeout: 15000,
  });
}

/** Real Auth/PostgREST, production handler, and real SDK; only the provider is loopback. */
async function executionFixture(options: { loseReceipt?: "claim" | "finish"; holdProvider?: boolean; alterClaimNode?: boolean;
  unacquiredClaim?: boolean; clearBeforeClaim?: boolean; leaseMilliseconds?: number; sourceLifetime?: 3; observerOutage?: boolean; afterBegin?: () => void } = {}) {
  const owner = await transcriptFixture(), edgeSecret = process.env.BLUEPRINT_EXPLANATION_EDGE_TEST_SECRET;
  const workerKey = edgeSecret ?? randomUUID() + randomUUID();
  const providerBodies: string[] = [], workerBodies: string[] = [];
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
  const handler = createExplanationWorker({ url: owner.local.API_URL, anonKey: owner.local.PUBLISHABLE_KEY,
    serviceRoleKey: owner.local.SERVICE_ROLE_KEY, workerSecret: workerKey }, (url, key, options) => {
    const client = createClient(url, key, options);
    return { auth: client.auth, rpc: (name, args) => client.rpc(name, args) };
  });
  const server = createServer(async (request, response) => {
    try {
      let body = ""; for await (const chunk of request) body += chunk;
      if (request.method === "POST" && request.url === "/chat/completions") {
        providerBodies.push(body);
        if (options.holdProvider) await providerGate;
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "local-explanation-execution", object: "chat.completion", created: 0, model: "deepseek-flash",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 51, completion_tokens: 19, total_tokens: 70 } })); return;
      }
      if (request.method !== "POST" || request.url !== "/functions/v1/explanation-worker") { response.writeHead(404); response.end(); return; }
      workerBodies.push(body);
      if (options.clearBeforeClaim && JSON.parse(body).operation === "claim") {
        const run = await owner.client.rpc("read_explanation_run", { p_run_id: JSON.parse(body).runId });
        if (run.error || !run.data?.source_run_id) throw new Error("Missing fixture source");
        const cleared = await owner.client.rpc("clear_resource_evidence", { p_run_id: run.data.source_run_id });
        if (cleared.error) throw new Error("Fixture source clear failed");
      }
      const headers = new Headers(); for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
      const result = edgeSecret
        ? await fetch(`${owner.local.API_URL}/functions/v1/explanation-worker`, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) })
        : await handler(new Request("http://127.0.0.1/functions/v1/explanation-worker", { method: "POST", headers, body }));
      const operation = JSON.parse(body).operation;
      if (result.ok && operation === "claim" && (options.alterClaimNode || options.leaseMilliseconds)) {
        const receipt = await result.json();
        if (options.alterClaimNode) {
          const nodeId = randomUUID(); receipt.data.run.node_id = nodeId;
          if (receipt.data.run.input_page) receipt.data.run.input_page.context.nodeId = nodeId;
        }
        if (options.unacquiredClaim) receipt.data.acquired = false;
        if (options.leaseMilliseconds) receipt.data.run.expires_at = new Date(Date.parse(receipt.data.observed_at) + options.leaseMilliseconds).toISOString();
        response.writeHead(result.status, { "content-type": "application/json" }); response.end(JSON.stringify(receipt)); return;
      }
      if (result.ok && options.loseReceipt === operation && workerBodies.filter(value => JSON.parse(value).operation === operation).length === 1) {
        await result.arrayBuffer(); response.writeHead(503); response.end("LOCAL_ACK_LOST"); return;
      }
      // Fetch already decoded a compressed Edge body. Do not label the decoded
      // proxy bytes as gzip or retain the compressed Content-Length.
      const forwarded = new Headers(result.headers);
      forwarded.delete("content-encoding"); forwarded.delete("content-length");
      response.writeHead(result.status, Object.fromEntries(forwarded)); response.end(await result.text());
    } catch { response.writeHead(500); response.end(); }
  });
  async function cleanup() {
    releaseProvider();
    server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await owner.cleanup();
  }
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback port");
    const url = `http://127.0.0.1:${address.port}`, session = await owner.client.auth.getSession();
    if (!session.data.session) throw new Error("Missing own fixture session");
    const worker = createRemoteExplanationWorker({ url, publishableKey: owner.local.PUBLISHABLE_KEY, workerKey }, session.data.session.access_token, owner.ownerId);
    let beginResponses = 0;
    const caller = !options.observerOutage && !options.afterBegin ? owner.client : createClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${session.data.session.access_token}` }, fetch: async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        if (options.observerOutage && path.endsWith("/rpc/read_explanation_run") && providerBodies.length > 0)
          return new Response("LOCAL_OBSERVER_UNAVAILABLE", { status: 503 });
        const response = await fetch(input, init);
        if (response.ok && path.endsWith("/rpc/begin_explanation_run") && ++beginResponses === 1) options.afterBegin?.();
        return response;
      } },
    });
    const model = createPlanningModel("local-explanation-fixture", (input, init) => {
      const requested = new URL(input instanceof Request ? input.url : String(input));
      if (requested.origin !== "https://api.deepseek.com" || requested.pathname !== "/chat/completions") throw new Error("Unexpected provider endpoint");
      return fetch(`${url}${requested.pathname}`, init);
    });
    provisionFixtureQuota(owner.ownerId);
    const runner = createCloudExplanationRunner({ client: caller, actor: { userId: owner.ownerId, client: "web" }, worker, model });
    const command = { ...owner.command, sourceRunId: await owner.acquire(options.sourceLifetime), runId: randomUUID(), offset: 20, targetLanguage: "zh-Hans", selection, question: "怎样练习？" };
    return { owner, runner, command, providerBodies, workerBodies, releaseProvider, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

test("real account executes a source-bound explanation once through its independent authenticated Worker and recovers it", async () => {
  const fixture = await executionFixture();
  try {
    const result = await fixture.runner.run(fixture.command, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, run: { status: "ready", result: { status: "explained", answer, usage: { totalTokens: 70 } } } });
    expect(await fixture.runner.read(fixture.command.runId)).toEqual(result);
    expect(await fixture.runner.run(fixture.command, new AbortController().signal)).toEqual(result);
    expect(fixture.providerBodies).toHaveLength(1);
    expect(fixture.workerBodies.map(body => JSON.parse(body).operation)).toEqual(["claim", "finish"]);
    expect(fixture.providerBodies[0]).not.toContain(fixture.owner.ownerId);
    expect(fixture.providerBodies[0]).not.toContain("用影像讲述生活");
  } finally { await fixture.cleanup(); }
});

test("a lost explanation finish acknowledgement recovers the same committed result without repeating generation", async () => {
  const fixture = await executionFixture({ loseReceipt: "finish" });
  try {
    const result = await fixture.runner.run(fixture.command, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, run: { status: "ready", result: { status: "explained", answer } } });
    expect(await fixture.runner.read(fixture.command.runId)).toEqual(result);
    expect(fixture.providerBodies).toHaveLength(1);
    expect(fixture.workerBodies.map(body => JSON.parse(body).operation)).toEqual(["claim", "finish", "finish"]);
    expect(fixture.workerBodies[1]).toBe(fixture.workerBodies[2]);
  } finally { await fixture.cleanup(); }
});

test("a lost claim acknowledgement never reacquires the explanation or sends a provider request", async () => {
  const fixture = await executionFixture({ loseReceipt: "claim" });
  try {
    expect(await fixture.runner.run(fixture.command, new AbortController().signal)).toEqual({ ok: false, code: "unavailable" });
    expect(await fixture.runner.read(fixture.command.runId)).toMatchObject({ ok: true, run: { status: "running" } });
    expect(await fixture.runner.run(fixture.command, new AbortController().signal)).toMatchObject({ ok: true, run: { status: "running" } });
    expect(fixture.providerBodies).toEqual([]);
    expect(fixture.workerBodies.map(body => JSON.parse(body).operation)).toEqual(["claim"]);
  } finally { await fixture.cleanup(); }
});

test("cancelling a running explanation in the database stops an unresponsive provider and preserves cancellation", async () => {
  const fixture = await executionFixture({ holdProvider: true }), controller = new AbortController();
  const work = fixture.runner.run(fixture.command, controller.signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect.poll(() => fixture.providerBodies.length, { timeout: 5000 }).toBe(1);
    expect(await fixture.runner.cancel(fixture.command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
    const result = await Promise.race([work, new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Explanation did not observe cancellation")), 3500);
    })]);
    expect(result).toMatchObject({ ok: true, run: { status: "cancelled", result: { status: "cancelled", providerMayHaveRun: true } } });
    expect(fixture.providerBodies).toHaveLength(1);
  } finally { clearTimeout(timeout); controller.abort(); fixture.releaseProvider(); await work; await fixture.cleanup(); }
});

test("an already-aborted explanation creates no reservation and leaves the account quota available", async () => {
  const fixture = await executionFixture(), controller = new AbortController(); controller.abort();
  try {
    expect(await fixture.runner.run(fixture.command, controller.signal)).toEqual({ ok: false, code: "cancelled" });
    expect(await fixture.runner.read(fixture.command.runId)).toEqual({ ok: false, code: "not_found" });
    expect(fixture.providerBodies).toEqual([]); expect(fixture.workerBodies).toEqual([]);
    expect(await fixture.runner.run({ ...fixture.command, runId: randomUUID() }, new AbortController().signal))
      .toMatchObject({ ok: true, run: { status: "ready" } });
  } finally { await fixture.cleanup(); }
});

test.each([false, true])("a well-formed claim changed to another node is rejected before inference (unacquired=%s)", async unacquiredClaim => {
  const fixture = await executionFixture({ alterClaimNode: true, unacquiredClaim });
  try {
    expect(await fixture.runner.run(fixture.command, new AbortController().signal)).toEqual({ ok: false, code: "unavailable" });
    expect(fixture.providerBodies).toHaveLength(0);
    expect(fixture.workerBodies.map(body => JSON.parse(body).operation)).toEqual(["claim"]);
  } finally { await fixture.cleanup(); }
});

test.each([false, true])("a source cleared before claim keeps only its matching recovery identity (altered=%s)", async alterClaimNode => {
  const fixture = await executionFixture({ clearBeforeClaim: true, alterClaimNode });
  try {
    const result = await fixture.runner.run(fixture.command, new AbortController().signal);
    if (alterClaimNode) expect(result).toEqual({ ok: false, code: "unavailable" });
    else expect(result).toMatchObject({ ok: true, run: { id: fixture.command.runId, status: "cleared", result: null, input_page: null } });
    expect(fixture.providerBodies).toEqual([]);
    expect(fixture.workerBodies.map(body => JSON.parse(body).operation)).toEqual(["claim"]);
  } finally { await fixture.cleanup(); }
});

test("the explanation execution lease ends a waiting provider before the source lifetime ends", async () => {
  const fixture = await executionFixture({ holdProvider: true, leaseMilliseconds: 500 }), controller = new AbortController();
  const work = fixture.runner.run(fixture.command, controller.signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect.poll(() => fixture.providerBodies.length, { timeout: 5000 }).toBe(1);
    const result = await Promise.race([work, new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Explanation did not enforce execution lease")), 2500);
    })]);
    expect(result).toMatchObject({ ok: true, run: { status: "interrupted", result: { status: "timed_out", providerMayHaveRun: true } } });
    expect(fixture.providerBodies).toHaveLength(1);
  } finally { clearTimeout(timeout); controller.abort(); fixture.releaseProvider(); await work; await fixture.cleanup(); }
});

test.each(["clear", "explicit_abort", "expiry", "observer_outage"])("an in-flight explanation stops safely on %s", async action => {
  const fixture = await executionFixture({ holdProvider: true, sourceLifetime: action === "expiry" ? 3 : undefined, observerOutage: action === "observer_outage" });
  const controller = new AbortController(), work = fixture.runner.run(fixture.command, controller.signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect.poll(() => fixture.providerBodies.length, { timeout: 5000 }).toBe(1);
    if (action === "clear") expect((await fixture.owner.client.rpc("clear_resource_evidence", { p_run_id: fixture.command.sourceRunId })).error).toBeNull();
    if (action === "explicit_abort") controller.abort();
    const result = await Promise.race([work, new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Explanation did not observe invalidation")), 6000);
    })]);
    if (action === "clear" || action === "expiry") {
      expect(result).toMatchObject({ ok: true, run: { status: expect.stringMatching(/cleared|failed/), ...(action === "clear" ? { result: null } : {}) } });
      await expect.poll(() => fixture.runner.read(fixture.command.runId), { timeout: 3000 }).toMatchObject({ ok: true, run: { status: "cleared", result: null, input_page: null, selection: null, question: null } });
    } else expect(result).toMatchObject({ ok: true, run: { status: action === "observer_outage" ? "failed" : "cancelled",
      result: { status: action === "observer_outage" ? "unavailable" : "cancelled", providerMayHaveRun: true } } });
    expect(fixture.providerBodies).toHaveLength(1);
  } finally { clearTimeout(timeout); controller.abort(); fixture.releaseProvider(); await work; await fixture.cleanup(); }
});

test("caller abort immediately after begin acknowledgement cancels and refunds the confirmed reservation without claiming", async () => {
  const controller = new AbortController(), fixture = await executionFixture({ afterBegin: () => controller.abort() });
  try {
    expect(await fixture.runner.run(fixture.command, controller.signal)).toMatchObject({ ok: true, run: { status: "cancelled", result: { providerMayHaveRun: false } } });
    expect(fixture.providerBodies).toHaveLength(0); expect(fixture.workerBodies).toHaveLength(0);
    expect(await fixture.runner.run({ ...fixture.command, runId: randomUUID() }, new AbortController().signal))
      .toMatchObject({ ok: true, run: { status: "ready" } });
  } finally { await fixture.cleanup(); }
});

test("concurrent requests for the same explanation share one generation and exact-request recovery", async () => {
  const fixture = await executionFixture({ holdProvider: true }), controller = new AbortController();
  const work = Promise.all([fixture.runner.run(fixture.command, controller.signal), fixture.runner.run(fixture.command, controller.signal)]);
  try {
    await expect.poll(() => fixture.providerBodies.length, { timeout: 5000 }).toBe(1);
    fixture.releaseProvider();
    const results = await work;
    expect(results.every(result => result.ok && ["running", "ready"].includes(result.run.status))).toBe(true);
    expect(results.some(result => result.ok && result.run.status === "ready")).toBe(true);
    const saved = await fixture.runner.read(fixture.command.runId);
    expect(saved).toMatchObject({ ok: true, run: { status: "ready", result: { answer } } });
    expect(await fixture.runner.run(fixture.command, controller.signal)).toEqual(saved);
    const { runId, ...request } = fixture.command;
    expect(await fixture.runner.find(request)).toEqual({ ok: true, runId });
    expect(fixture.providerBodies).toHaveLength(1);
  } finally { controller.abort(); fixture.releaseProvider(); await work; await fixture.cleanup(); }
});
