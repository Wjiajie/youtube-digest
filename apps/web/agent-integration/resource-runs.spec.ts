import { afterEach, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createBlueprintApplication } from "@blueprint/domain";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createCloudResourceRunner } from "../src/lib/agent/cloud-resource-runner";
import { createResourceRunAccess } from "../src/lib/agent/resource-run-access";
import { createResourceWorkspace } from "../src/lib/agent/resource-workspace";
import type { ResourceWorker } from "../src/lib/agent/resource-worker";
import { createSupabaseBlueprintStore } from "../src/lib/supabase/store";
import { createResourceProvider } from "../src/lib/resources/provider";
import { createPlanningModel } from "../src/lib/agent/planning-runtime";

const local = localSupabaseTestConfig();
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions });
const accounts: Array<{ id: string; client: SupabaseClient }> = [];
const closers: Array<() => Promise<void>> = [];
const videoId = "abcdefghijk";
const preferences = { regionCode: "US", language: "zh", allowLanguageFallback: true, maxDurationSeconds: 1800, publishedAfter: null };
const learnerContext = { startingPoint: "只会自动模式", constraints: null };
const signal = () => new AbortController().signal;
function localSql(sql: string) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
// Local Auth/DB fixture only; production must use a separately verified worker transport.
function databaseWorker(ownerId: string): ResourceWorker {
  return {
    claim: async input => await admin.rpc("claim_resource_run", { p_owner_id: ownerId, p_run_id: input.runId, p_lease_id: input.leaseId, p_skill: input.skill }),
    finish: async input => await admin.rpc("finish_resource_run", { p_owner_id: ownerId, p_run_id: input.runId, p_lease_id: input.leaseId, p_result: input.result }),
  };
}
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const { id, client } of accounts.splice(0)) {
    await client.auth.signOut(); expect((await admin.auth.admin.deleteUser(id)).error?.code ?? null).toBeNull();
  }
});
async function fixture(credits = 5) {
  const id = randomUUID(), email = `${id}@resource-run.example.test`, password = randomUUID();
  expect((await admin.auth.admin.createUser({ id, email, password, email_confirm: true })).error?.code ?? null).toBeNull();
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: authOptions }); accounts.push({ id, client });
  expect((await client.auth.signInWithPassword({ email, password })).error?.code ?? null).toBeNull();
  for (let attempt = 0; attempt < 6; attempt++) {
    const probe = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
    if (!probe.error) break;
    if (probe.error.code !== "PGRST303" || attempt === 5) throw new Error(`Local read unavailable: ${probe.error.code}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const actor = { userId: id, client: "web" as const }, store = createSupabaseBlueprintStore(client);
  const current = await store.getMainBlueprint(id);
  if (!current) throw new Error("Missing fixture Blueprint");
  const nodeId = randomUUID();
  const draft = { ...current, goals: [{ id: randomUUID(), title: "摄影", position: 0, stages: [{ id: randomUUID(), title: "基础", position: 0,
    nodes: [{ id: nodeId, title: "曝光", type: "learn" as const, position: 0, estimatedMinutes: 30, completionCriteria: "拍摄三组对比照片", dependencyIds: [], resources: [] }] }] }] };
  const application = createBlueprintApplication({ store, newId: randomUUID, now: () => new Date() });
  const proposal = await application.createProposal(actor, { draft, baseVersion: 0, clientMutationId: randomUUID() });
  if (!proposal.ok) throw new Error("Could not save fixture proposal");
  expect((await application.applyProposal(actor, { proposalId: proposal.value.id, expectedVersion: 0, clientMutationId: randomUUID() })).ok).toBe(true);
  localSql(`insert into private.resource_quotas(owner_id,kind,available_attempts) values ('${id}','discover',${credits}),('${id}','captions',${credits}),('${id}','match',${credits});`);
  return { id, client, actor, store, application, nodeId, worker: databaseWorker(id),
    command: { kind: "discover" as const, runId: randomUUID(), nodeId, expectedBlueprintVersion: 1, preferences, learnerContext } };
}
function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value));
}
async function externalFixture(options: { pending?: boolean; jobStillPending?: boolean; rateLimit?: boolean } = {}) {
  const calls: string[] = [], modelBodies: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1"); calls.push(url.pathname);
    if (options.rateLimit) return json(response, { error: "PRIVATE_PROVIDER_FAILURE" }, 429);
    if (url.pathname === "/youtube/v3/search") return json(response, { items: [{ id: { kind: "youtube#video", videoId } }] });
    if (url.pathname === "/youtube/v3/videos") return json(response, { items: [{ id: videoId, snippet: { title: "曝光基础", description: "对比快门和光圈",
      channelId: "camera", channelTitle: "摄影", publishedAt: "2018-01-01T00:00:00Z", liveBroadcastContent: "none" }, contentDetails: { duration: "PT5M", caption: "true" },
      status: { privacyStatus: "public", uploadStatus: "processed", embeddable: false } }] });
    const caption = { lang: "en", availableLangs: ["en"], content: [{ text: "Compare aperture and shutter speed.", offset: 1500, duration: 2500 }] };
    if (url.pathname === "/v1/transcript") return options.pending ? json(response, { jobId: "owned-native-job" }, 202) : json(response, caption);
    if (url.pathname === "/v1/transcript/owned-native-job") return json(response, options.jobStillPending ? { status: "active" } : { status: "completed", ...caption });
    if (url.pathname === "/chat/completions") {
      let body = ""; request.setEncoding("utf8"); request.on("data", chunk => { body += chunk; }); request.on("end", () => {
        modelBodies.push(body);
        const answer = { summary: "候选支持曝光练习，仍需审阅。", assessments: [{ videoId, role: "recommended", relevance: "片段对比曝光参数。",
          levelFit: "基础难度待进一步确认。", languageFit: "英语字幕，允许回退。", timeFit: "五分钟观看，练习另计。", freshness: "基础知识不能按热度判定。",
          limitations: ["字幕无法证明视觉示范质量。"], evidence: [{ segmentIndex: 0, quote: "Compare aperture and shutter speed." }] }] };
        json(response, { id: "fixture-matching", object: "chat.completion", created: 0, model: "deepseek-v4-flash",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 123, completion_tokens: 234, total_tokens: 357 } });
      }); return;
    }
    json(response, { error: "Unexpected fixture URL" }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
  closers.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!["https://www.googleapis.com", "https://api.supadata.ai", "https://api.deepseek.com"].includes(url.origin)) throw new Error("Unexpected external origin");
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  };
  return { calls, modelBodies, provider: createResourceProvider({ youtubeApiKey: "fixture-youtube-key", supadataApiKey: "fixture-native-key", fetch: fetcher }),
    model: createPlanningModel("fixture-model-key", fetcher) };
}

it("persists an account's discovery → explicit native-job read → grounded match and recovers each without new external calls", async () => {
  const owner = await fixture(), external = await externalFixture({ pending: true });
  const runner = createCloudResourceRunner({ ...owner, ...external });
  const discovered = await runner.run(owner.command, signal());
  expect(discovered).toMatchObject({ ok: true, run: { status: "ready", kind: "discover", result: { status: "discovered", candidates: [{ transcript: { status: "pending", jobId: "owned-native-job" } }] } } });
  expect(await runner.run(owner.command, signal())).toEqual(discovered);
  expect(external.calls).toEqual(["/youtube/v3/search", "/youtube/v3/videos", "/v1/transcript"]);
  const captionsCommand = { kind: "captions", runId: randomUUID(), sourceRunId: owner.command.runId };
  const captions = await runner.run(captionsCommand, signal());
  expect(captions).toMatchObject({ ok: true, run: { status: "ready", kind: "captions", result: { status: "discovered", candidates: [{ transcript: { status: "ready", language: "en" }, eligibleForMatching: true }] } } });
  const matchCommand = { kind: "match", runId: randomUUID(), sourceRunId: captionsCommand.runId };
  const matched = await runner.run(matchCommand, signal());
  expect(matched).toMatchObject({ ok: true, run: { status: "ready", kind: "match", result: { status: "matched", reviewRequired: true,
    source: { blueprintVersion: 1, nodeId: owner.nodeId }, assessments: [{ videoId, evidence: [{ segmentIndex: 0, offsetMs: 1500 }] }] } } });
  const access = createResourceRunAccess(owner.client, owner.actor);
  expect(await access.read(matchCommand.runId)).toEqual(matched);
  expect(await runner.run(matchCommand, signal())).toEqual(matched);
  expect(await runner.run(captionsCommand, signal())).toEqual(captions);
  expect(external.calls).toEqual(["/youtube/v3/search", "/youtube/v3/videos", "/v1/transcript", "/v1/transcript/owned-native-job", "/chat/completions"]);
  expect(external.modelBodies).toHaveLength(1);
  expect(JSON.stringify(matched)).not.toMatch(/fixture-.*key|PRIVATE_PROVIDER_FAILURE/);
  expect(localSql(`select kind || ':' || available_attempts from private.resource_quotas where owner_id='${owner.id}' order by kind`)).toBe("captions:4\ndiscover:4\nmatch:4");
  expect((await owner.store.getMainBlueprint(owner.id))?.version).toBe(1);
});

it("serves a private resource workbench with current node context, safe evidence, history and only one follow-up", async () => {
  const owner = await fixture(), outsider = await fixture(), external = await externalFixture({ pending: true });
  const runner = createCloudResourceRunner({ ...owner, ...external });
  const workspace = createResourceWorkspace(owner.client, owner.actor);
  expect(await workspace.node(owner.nodeId)).toMatchObject({ ok: true, value: { nodeTitle: "曝光", blueprintVersion: 1, records: [], hasMore: false } });
  expect((await runner.run(owner.command, signal())).ok).toBe(true);
  const first = await workspace.read(owner.command.runId);
  expect(first).toMatchObject({ ok: true, value: { nextKind: "captions", childId: null, result: { candidates: [{ transcriptStatus: "pending", assessment: null }] } } });
  expect(JSON.stringify(first)).not.toMatch(/owned-native-job|input_blueprint|instructions|segments|apiKey/);
  const next = { kind: "captions", sourceRunId: owner.command.runId, runId: randomUUID() };
  expect((await runner.run(next, signal())).ok).toBe(true);
  expect(await workspace.read(owner.command.runId)).toMatchObject({ ok: true, value: { nextKind: null, childId: next.runId } });
  expect(await workspace.read(next.runId)).toMatchObject({ ok: true, value: { nextKind: "match", result: { candidates: [{ language: "en", languageFallback: true }] } } });
  const matched = { kind: "match", sourceRunId: next.runId, runId: randomUUID() };
  expect((await runner.run(matched, signal())).ok).toBe(true);
  expect(await workspace.read(matched.runId)).toMatchObject({ ok: true, value: { nextKind: null, skillVersion: "1.0.0", result: { candidates: [{ assessment: {
    role: "recommended", evidence: [{ quote: "Compare aperture and shutter speed.", offsetMs: 1500 }], totalSegments: 1, sampledSegments: 1,
  } }] } } });
  const listed = await workspace.node(owner.nodeId);
  if (!listed.ok) throw new Error("Missing resource workspace");
  expect(listed.value.records.map(row => row.id)).toEqual([matched.runId, next.runId, owner.command.runId]);
  expect(await workspace.node(owner.nodeId, -1)).toEqual({ ok: false, code: "invalid" });
  expect(await createResourceWorkspace(outsider.client, outsider.actor).read(matched.runId)).toEqual({ ok: false, code: "not_found" });
  expect(await createResourceWorkspace(outsider.client, outsider.actor).node(owner.nodeId)).toEqual({ ok: false, code: "not_found" });
  expect(await createResourceWorkspace(owner.client, { ...owner.actor, client: "extension" }).node(owner.nodeId)).toEqual({ ok: false, code: "forbidden" });
  expect(external.calls).toHaveLength(5);
});

it("resource history paginates without executing work, and explicit cancellation recovers a queued operation", async () => {
  const owner = await fixture(1), workspace = createResourceWorkspace(owner.client, owner.actor), ids: string[] = [];
  for (let i = 0; i < 22; i++) {
    const runId = randomUUID(); ids.push(runId);
    expect((await owner.client.rpc("begin_resource_run", { p_request: { ...owner.command, runId } })).error).toBeNull();
    expect(await workspace.cancel(runId)).toMatchObject({ ok: true, value: { status: "cancelled", nextKind: null } });
  }
  const first = await workspace.node(owner.nodeId), second = await workspace.node(owner.nodeId, 20);
  if (!first.ok || !second.ok) throw new Error("Missing history");
  expect(first.value.hasMore).toBe(true); expect(first.value.records).toHaveLength(20);
  expect(second.value.hasMore).toBe(false); expect(second.value.records).toHaveLength(2);
  expect([...first.value.records, ...second.value.records].map(row => row.id)).toEqual(ids.reverse());
  expect(await workspace.node(owner.nodeId, 40)).toMatchObject({ ok: true, value: { records: [], hasMore: false } });
  expect(localSql(`select available_attempts from private.resource_quotas where owner_id='${owner.id}' and kind='discover'`)).toBe("1");
});

it("resource review reconciles expired and changed sources, preserving a cancelled successor link", async () => {
  const owner = await fixture(), workspace = createResourceWorkspace(owner.client, owner.actor), external = await externalFixture({ pending: true });
  const runner = createCloudResourceRunner({ ...owner, ...external });
  expect((await runner.run(owner.command, signal())).ok).toBe(true);
  const childId = randomUUID();
  expect((await owner.client.rpc("begin_resource_run", { p_request: { kind: "captions", runId: childId, sourceRunId: owner.command.runId } })).error).toBeNull();
  localSql(`update public.resource_runs set expires_at=clock_timestamp()-interval '1 second' where id='${childId}';`);
  expect(await workspace.read(childId)).toMatchObject({ ok: true, value: { status: "cancelled", nextKind: null } });
  expect(await workspace.read(owner.command.runId)).toMatchObject({ ok: true, value: { childId, nextKind: null } });
  const queued = randomUUID();
  expect((await owner.client.rpc("begin_resource_run", { p_request: { ...owner.command, runId: queued } })).error).toBeNull();
  expect((await workspace.cancel(queued)).ok).toBe(true);
  const current = await owner.store.getMainBlueprint(owner.id);
  if (!current) throw new Error("Missing blueprint");
  const proposal = await owner.application.createProposal(owner.actor, { draft: { ...current, goals: [] }, baseVersion: current.version, clientMutationId: randomUUID() });
  if (!proposal.ok) throw new Error("Missing proposal");
  expect((await owner.application.applyProposal(owner.actor, { proposalId: proposal.value.id, expectedVersion: current.version, clientMutationId: randomUUID() })).ok).toBe(true);
  expect(await workspace.read(owner.command.runId)).toMatchObject({ ok: true, value: { status: "stale", nextKind: null, nodeTitle: "曝光", childId } });
  expect(await workspace.node(owner.nodeId)).toEqual({ ok: false, code: "not_found" });
  expect(external.calls).toHaveLength(3);
});

it("zero per-stage quota rejects execution before any external request", async () => {
  const owner = await fixture(0), external = await externalFixture();
  const runner = createCloudResourceRunner({ ...owner, ...external });
  expect(await runner.run(owner.command, signal())).toEqual({ ok: false, code: "quota_exhausted" });
  expect(await runner.read(owner.command.runId)).toEqual({ ok: false, code: "not_found" });
  expect(external.calls).toEqual([]);
});

it("other accounts and extension identities cannot read, cancel, continue or execute the owner's records", async () => {
  const owner = await fixture(), outsider = await fixture(), external = await externalFixture({ pending: true });
  const runner = createCloudResourceRunner({ ...owner, ...external });
  expect((await runner.run(owner.command, signal())).ok).toBe(true);
  const foreign = createCloudResourceRunner({ ...outsider, ...external });
  expect(await foreign.read(owner.command.runId)).toEqual({ ok: false, code: "not_found" });
  expect(await foreign.cancel(owner.command.runId)).toEqual({ ok: false, code: "not_found" });
  expect(await foreign.run({ kind: "captions", runId: randomUUID(), sourceRunId: owner.command.runId }, signal())).toEqual({ ok: false, code: "not_found" });
  const forged = createCloudResourceRunner({ ...outsider, ...external, actor: owner.actor });
  expect((await forged.run({ ...outsider.command, runId: randomUUID() }, signal())).ok).toBe(false);
  const extension = createCloudResourceRunner({ ...owner, ...external, actor: { ...owner.actor, client: "extension" } });
  expect(await extension.read(owner.command.runId)).toEqual({ ok: false, code: "forbidden" });
  expect(await extension.run(owner.command, signal())).toEqual({ ok: false, code: "forbidden" });
  expect(external.calls).toHaveLength(3);
});

it("uncertain claim delivery never launches providers or reclaims a charged operation", async () => {
  const owner = await fixture(1), external = await externalFixture();
  const worker: ResourceWorker = { ...owner.worker, async claim(input) {
    expect((await owner.worker.claim(input)).error).toBeNull();
    return { data: null, error: { code: "unavailable", message: "PRIVATE_TRANSPORT_FAILURE" } };
  } };
  const runner = createCloudResourceRunner({ ...owner, ...external, worker });
  expect(await runner.run(owner.command, signal())).toEqual({ ok: false, code: "unavailable" });
  expect(await runner.read(owner.command.runId)).toMatchObject({ ok: true, run: { status: "running" } });
  expect(await runner.run(owner.command, signal())).toMatchObject({ ok: true, run: { status: "running" } });
  // Fixture-only clock setup, then verify expiry through the actual public read seam.
  localSql(`update public.resource_runs set expires_at=clock_timestamp()-interval '1 second' where id='${owner.command.runId}';`);
  expect(await runner.read(owner.command.runId)).toMatchObject({ ok: true, run: { status: "interrupted", result: { status: "timed_out" } } });
  expect(await runner.run({ ...owner.command, runId: randomUUID() }, signal())).toEqual({ ok: false, code: "quota_exhausted" });
  expect(external.calls).toEqual([]);
});

it("lost completion response retries only the identical receipt, not discovery", async () => {
  const owner = await fixture(1), external = await externalFixture();
  const finishes: string[] = [];
  const worker: ResourceWorker = { ...owner.worker, async finish(input) {
    finishes.push(JSON.stringify(input)); const receipt = await owner.worker.finish(input);
    expect(receipt.error).toBeNull();
    return finishes.length === 1 ? { data: null, error: { code: "unavailable", message: "lost response" } } : receipt;
  } };
  const runner = createCloudResourceRunner({ ...owner, ...external, worker });
  expect(await runner.run(owner.command, signal())).toMatchObject({ ok: true, run: { status: "ready" } });
  expect(finishes).toHaveLength(2); expect(finishes[0]).toEqual(finishes[1]);
  expect(external.calls).toHaveLength(3);
  expect(await runner.run(owner.command, signal())).toMatchObject({ ok: true, run: { status: "ready" } });
  expect(finishes).toHaveLength(2); expect(external.calls).toHaveLength(3);
});

it("pending jobs require explicit continuation; replay does not poll and each parent admits only one child", async () => {
  const owner = await fixture(), external = await externalFixture({ pending: true, jobStillPending: true });
  const runner = createCloudResourceRunner({ ...owner, ...external });
  expect((await runner.run(owner.command, signal())).ok).toBe(true);
  expect(await runner.run({ kind: "match", runId: randomUUID(), sourceRunId: owner.command.runId }, signal())).toEqual({ ok: false, code: "invalid" });
  expect(await runner.run({ kind: "captions", runId: randomUUID(), sourceRunId: owner.command.runId, jobId: "injected-job" }, signal())).toEqual({ ok: false, code: "invalid" });
  const child = { kind: "captions", runId: randomUUID(), sourceRunId: owner.command.runId };
  const saved = await runner.run(child, signal());
  expect(saved).toMatchObject({ ok: true, run: { status: "ready", result: { candidates: [{ transcript: { status: "pending", jobId: "owned-native-job" } }] } } });
  expect(await runner.run(child, signal())).toEqual(saved);
  expect(await runner.run({ ...child, runId: randomUUID() }, signal())).toEqual({ ok: false, code: "invalid" });
  expect(external.calls).toHaveLength(4);
  expect((await runner.run({ ...child, runId: randomUUID(), sourceRunId: child.runId }, signal())).ok).toBe(true);
  expect(external.calls.slice(3)).toEqual(["/v1/transcript/owned-native-job", "/v1/transcript/owned-native-job"]);
});

it("changing the formal Blueprint makes saved evidence stale and prevents new matching", async () => {
  const owner = await fixture(), external = await externalFixture();
  const runner = createCloudResourceRunner({ ...owner, ...external });
  expect((await runner.run(owner.command, signal())).ok).toBe(true);
  const current = await owner.store.getMainBlueprint(owner.id);
  if (!current) throw new Error("Missing Blueprint");
  const proposal = await owner.application.createProposal(owner.actor, { draft: { ...current, title: "改变目标后的蓝图" }, baseVersion: 1, clientMutationId: randomUUID() });
  if (!proposal.ok) throw new Error("Missing proposal");
  expect((await owner.application.applyProposal(owner.actor, { proposalId: proposal.value.id, expectedVersion: 1, clientMutationId: randomUUID() })).ok).toBe(true);
  expect(await runner.read(owner.command.runId)).toMatchObject({ ok: true, run: { status: "stale", blueprintVersion: 1, result: { status: "discovered" } } });
  expect(await runner.run({ kind: "match", runId: randomUUID(), sourceRunId: owner.command.runId }, signal())).toEqual({ ok: false, code: "invalid" });
  expect(external.calls).toHaveLength(3);
});

it("cancelling a queued reservation refunds once and never launches work on replay", async () => {
  const owner = await fixture(1), external = await externalFixture();
  expect((await owner.client.rpc("begin_resource_run", { p_request: owner.command })).error).toBeNull();
  const runner = createCloudResourceRunner({ ...owner, ...external });
  expect(await runner.cancel(owner.command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
  expect(await runner.cancel(owner.command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
  expect(await runner.run(owner.command, signal())).toMatchObject({ ok: true, run: { status: "cancelled" } });
  expect(external.calls).toHaveLength(0);
  expect((await runner.run({ ...owner.command, runId: randomUUID() }, signal())).ok).toBe(true);
  expect(await runner.run({ ...owner.command, runId: randomUUID() }, signal())).toEqual({ ok: false, code: "quota_exhausted" });
});

it("aborting after a lease is claimed records cancellation without refund or provider calls", async () => {
  const owner = await fixture(1), external = await externalFixture(), controller = new AbortController();
  const worker: ResourceWorker = { ...owner.worker, async claim(input) {
    const receipt = await owner.worker.claim(input); controller.abort("PRIVATE_ABORT_REASON"); return receipt;
  } };
  const runner = createCloudResourceRunner({ ...owner, ...external, worker });
  expect(await runner.run(owner.command, controller.signal)).toMatchObject({ ok: true, run: { status: "cancelled", result: { status: "cancelled" } } });
  expect(external.calls).toEqual([]);
  expect(await runner.run({ ...owner.command, runId: randomUUID() }, signal())).toEqual({ ok: false, code: "quota_exhausted" });
});

it("rate-limited discovery saves a sanitized terminal failure that is not automatically retried", async () => {
  const owner = await fixture(), external = await externalFixture({ rateLimit: true });
  const runner = createCloudResourceRunner({ ...owner, ...external });
  const result = await runner.run(owner.command, signal());
  expect(result).toMatchObject({ ok: true, run: { status: "failed", result: { status: "rate_limited", requests: { catalogMayHaveRun: true } } } });
  expect(await runner.run(owner.command, signal())).toEqual(result);
  expect(external.calls).toEqual(["/youtube/v3/search"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_FAILURE");
});

it("simultaneous submissions of the same operation execute the provider at most once", async () => {
  const owner = await fixture(1), external = await externalFixture();
  const runner = createCloudResourceRunner({ ...owner, ...external });
  const results = await Promise.all([runner.run(owner.command, signal()), runner.run(owner.command, signal())]);
  expect(results.every(result => result.ok)).toBe(true);
  expect(await runner.read(owner.command.runId)).toMatchObject({ ok: true, run: { status: "ready" } });
  expect(external.calls).toEqual(["/youtube/v3/search", "/youtube/v3/videos", "/v1/transcript"]);
});

it("a source edit while matching is in flight stores the result as stale rather than presenting it as current", async () => {
  const owner = await fixture(), external = await externalFixture();
  const discover = createCloudResourceRunner({ ...owner, ...external });
  expect((await discover.run(owner.command, signal())).ok).toBe(true);
  const worker: ResourceWorker = { ...owner.worker, async finish(input) {
    const current = await owner.store.getMainBlueprint(owner.id);
    if (!current) throw new Error("Missing Blueprint");
    const proposal = await owner.application.createProposal(owner.actor, { draft: { ...current, title: "执行期间修改蓝图" }, baseVersion: 1, clientMutationId: randomUUID() });
    if (!proposal.ok) throw new Error("Missing proposal");
    expect((await owner.application.applyProposal(owner.actor, { proposalId: proposal.value.id, expectedVersion: 1, clientMutationId: randomUUID() })).ok).toBe(true);
    return owner.worker.finish(input);
  } };
  const runner = createCloudResourceRunner({ ...owner, ...external, worker });
  const command = { kind: "match", runId: randomUUID(), sourceRunId: owner.command.runId };
  const result = await runner.run(command, signal());
  expect(result).toMatchObject({ ok: true, run: { status: "stale", blueprintVersion: 1, result: { status: "matched", reviewRequired: true } } });
  expect(await runner.read(command.runId)).toEqual(result);
  expect(await runner.run(command, signal())).toEqual(result);
  expect(external.calls).toHaveLength(4);
});
