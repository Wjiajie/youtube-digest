import { afterEach, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createCloudPathPlanner } from "../src/lib/agent/cloud-path-planner";
import { createPlanningRunAccess } from "../src/lib/agent/planning-access";
import { createPlanningApprovalAccess } from "../src/lib/agent/planning-approval";

const local = localSupabaseTestConfig();
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions });
const accounts: Array<{ id: string; client: SupabaseClient }> = [];

afterEach(async () => {
  for (const { id, client } of accounts.splice(0)) {
    await client.auth.signOut();
    const deleted = await admin.auth.admin.deleteUser(id);
    expect(deleted.error?.code ?? null).toBeNull();
  }
});

function localSql(sql: string) {
  return execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function fixture(credits = 5) {
  const id = randomUUID(), email = `${id}@planning-run.example.test`, password = randomUUID();
  const created = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
  expect(created.error?.code ?? null).toBeNull();
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: authOptions });
  accounts.push({ id, client });
  expect((await client.auth.signInWithPassword({ email, password })).error?.code ?? null).toBeNull();
  // Read readiness only: never retry an Auth mutation or change issued claims.
  for (let attempt = 0; attempt < 6; attempt++) {
    const probe = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
    if (!probe.error) break;
    if (probe.error.code !== "PGRST303" || attempt === 5) throw new Error(`Local read unavailable: ${probe.error.code}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const briefId = randomUUID();
  const saved = await client.rpc("save_goal_brief", { p_id: briefId, p_expected_revision: 0, p_confirm: true, p_client_mutation_id: randomUUID(),
    p_content: { schemaVersion: 1, outcome: "完成一组摄影作品", startingPoint: "会使用相机", weeklyMinutes: 180,
      targetDate: null, constraints: "只有周末有空", successCriteria: "选出六张照片并记录反馈" } });
  expect(saved.error?.code ?? null).toBeNull();
  localSql(`insert into private.path_planning_quotas(owner_id,available_attempts) values ('${id}',${credits});`);
  return { id, client, briefId, command: { runId: randomUUID(), briefId, expectedBriefRevision: 1, expectedBlueprintVersion: 0, startDate: new Date().toISOString().slice(0, 10) } };
}

function providerReply(): Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>> {
  return { content: [{ type: "text", text: JSON.stringify({ title: "摄影作品", description: "拍摄后评估作品", assumptions: ["周末有空"], stages: [
    { title: "开始拍摄", nodes: [{ key: "shoot", type: "practice", title: "拍摄六张照片", description: "围绕同一个主题取景", estimatedMinutes: 60,
      completionCriteria: "选出六张并记录取舍", week: 1, dependsOn: [] }] },
  ] }) }], finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 40, text: 40, reasoning: undefined } }, warnings: [] };
}

it("persists a real account's complete reviewable planning result and replays without regeneration", async () => {
  const owner = await fixture();
  const model = new MockLanguageModelV4({ doGenerate: providerReply() });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  const result = await planner.run(owner.command, new AbortController().signal);
  expect(result).toMatchObject({ ok: true, run: { id: owner.command.runId, ownerId: owner.id, status: "ready" } });
  expect(await planner.read(owner.command.runId)).toEqual(result);
  expect(await planner.run(owner.command, new AbortController().signal)).toEqual(result);
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(localSql(`select available_attempts from private.path_planning_quotas where owner_id='${owner.id}'`)).toBe("4");
  const blueprint = await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.id });
  expect(blueprint.error).toBeNull(); expect(blueprint.data.goals).toEqual([]); expect(blueprint.data.version).toBe(0);
  if (!result.ok || result.run.result?.status !== "ready") throw new Error("Expected persisted reviewable result");
  expect(result.run.result.schedule).toEqual([{ nodeId: result.run.result.draft.goals[0].stages[0].nodes[0].id, week: 1 }]);
  expect(result.run.result.skill.instructions).toContain("# 可审阅路径规划");
  expect(await planner.run({ ...owner.command, expectedBriefRevision: 2 }, new AbortController().signal)).toEqual({ ok: false, code: "invalid" });
});

it("does not run a provider without account credits", async () => {
  const owner = await fixture(0);
  const model = new MockLanguageModelV4();
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  expect(await planner.run(owner.command, new AbortController().signal)).toEqual({ ok: false, code: "quota_exhausted" });
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(await planner.read(owner.command.runId)).toEqual({ ok: false, code: "not_found" });
});

it("prepares once, explicitly applies, and recovers the exact planning approval after source changes", async () => {
  const owner = await fixture(); const model = new MockLanguageModelV4({ doGenerate: providerReply() });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  expect(await planner.run(owner.command, new AbortController().signal)).toMatchObject({ ok: true, run: { status: "ready" } });
  const approval = createPlanningApprovalAccess(owner.client, { userId: owner.id, client: "web" });
  expect(await approval.read(owner.command.runId)).toMatchObject({ ok: true, value: { proposal: null, sourceCurrent: true } });
  const prepared = await approval.prepare(owner.command.runId);
  expect(prepared).toMatchObject({ ok: true, value: { proposal: { status: "pending", appliedVersion: null } } });
  expect(await approval.prepare(owner.command.runId)).toEqual(prepared);
  expect((await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.id })).data.goals).toEqual([]);
  if (!prepared.ok || !prepared.value.proposal) throw new Error("Expected persisted proposal");
  const proposal = prepared.value.proposal;
  expect(await approval.apply(owner.command.runId, proposal.id, proposal.baseVersion)).toMatchObject({ ok: true,
    value: { proposal: { id: proposal.id, status: "applied", appliedVersion: 1 } } });
  const formal = await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.id });
  expect(formal.error).toBeNull(); expect(formal.data.version).toBe(1); expect(formal.data.goals).toHaveLength(1);
  const brief = await owner.client.from("goal_briefs").select("content").eq("id", owner.briefId).single();
  expect((await owner.client.rpc("save_goal_brief", { p_id: owner.briefId, p_expected_revision: 1, p_confirm: false,
    p_content: brief.data!.content, p_client_mutation_id: randomUUID() })).error).toBeNull();
  expect(await approval.apply(owner.command.runId, proposal.id, proposal.baseVersion)).toMatchObject({ ok: true,
    value: { sourceCurrent: false, proposal: { status: "applied", appliedVersion: 1 } } });
  expect(await approval.apply(owner.command.runId, proposal.id, proposal.baseVersion + 1)).toEqual({ ok: false, code: "version_conflict" });
  expect(model.doGenerateCalls).toHaveLength(1);
});

it("binds concurrent preparations to one immutable proposal, rejects changed sources and isolates owners", async () => {
  const owner = await fixture(), outsider = await fixture();
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" },
    model: new MockLanguageModelV4({ doGenerate: providerReply() }) });
  expect((await planner.run(owner.command, new AbortController().signal)).ok).toBe(true);
  const approval = createPlanningApprovalAccess(owner.client, { userId: owner.id, client: "web" });
  const [one, two] = await Promise.all([approval.prepare(owner.command.runId), approval.prepare(owner.command.runId)]);
  expect(one).toEqual(two);
  if (!one.ok || !one.value.proposal) throw new Error("Expected proposal");
  const proposal = one.value.proposal;
  const forbidden = createPlanningApprovalAccess(outsider.client, { userId: outsider.id, client: "web" });
  for (const operation of [() => forbidden.read(owner.command.runId), () => forbidden.prepare(owner.command.runId),
    () => forbidden.reject(owner.command.runId), () => forbidden.apply(owner.command.runId, proposal.id, 0)])
    expect(await operation()).toEqual({ ok: false, code: "not_found" });
  const tamper = await owner.client.from("blueprint_proposals").update({ status: "rejected" }).eq("id", proposal.id).select("id");
  expect(tamper.error).toBeNull(); expect(tamper.data).toEqual([]);
  const brief = await owner.client.from("goal_briefs").select("content").eq("id", owner.briefId).single();
  expect((await owner.client.rpc("save_goal_brief", { p_id: owner.briefId, p_expected_revision: 1, p_confirm: false,
    p_content: brief.data!.content, p_client_mutation_id: randomUUID() })).error).toBeNull();
  // The old public entry must enforce the same final source guard, not just the new adapter.
  expect((await owner.client.rpc("apply_blueprint_proposal", { proposal_id: proposal.id, expected_version: 0, mutation_id: proposal.id })).error?.code).toBe("40001");
  expect(await approval.apply(owner.command.runId, proposal.id, 0)).toEqual({ ok: false, code: "version_conflict" });
  expect(await approval.read(owner.command.runId)).toMatchObject({ ok: true, value: { sourceCurrent: false, proposal: { status: "pending" } } });
  const rejected = await approval.reject(owner.command.runId);
  expect(rejected).toMatchObject({ ok: true, value: { proposal: { status: "rejected" } } });
  expect(await approval.reject(owner.command.runId)).toEqual(rejected);
  expect(await approval.prepare(owner.command.runId)).toEqual(rejected);
  expect((await owner.client.rpc("read_blueprint_snapshot_v2", { p_owner_id: owner.id })).data.goals).toEqual([]);
});

it("lets an owner discover and recover runs without a model or worker credential", async () => {
  const owner = await fixture(), outsider = await fixture();
  const access = createPlanningRunAccess(owner.client, { userId: owner.id, client: "web" });
  expect(await access.list(owner.briefId)).toEqual({ ok: true, value: { runs: [], hasMore: false } });
  const command = owner.command;
  expect((await owner.client.rpc("begin_path_planning", { p_run_id: command.runId, p_brief_id: command.briefId,
    p_expected_brief_revision: 1, p_expected_blueprint_version: 0, p_start_date: command.startDate })).error).toBeNull();
  expect(await access.list(owner.briefId)).toMatchObject({ ok: true, value: { runs: [{ id: command.runId }], hasMore: false } });
  expect(await access.read(command.runId)).toMatchObject({ ok: true, run: { status: "queued" } });
  const denied = createPlanningRunAccess(outsider.client, { userId: outsider.id, client: "web" });
  expect(await denied.read(command.runId)).toEqual({ ok: false, code: "not_found" });
  expect(await denied.list(owner.briefId)).toEqual({ ok: true, value: { runs: [], hasMore: false } });
  expect(await access.cancel(command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
  expect(await access.read(command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
  expect(await access.list(owner.briefId, -1)).toEqual({ ok: false, code: "invalid" });
});

it("enforces the real JWT owner even when a server caller supplies another actor ID", async () => {
  const owner = await fixture(), outsider = await fixture();
  const model = new MockLanguageModelV4({ doGenerate: providerReply() });
  const own = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  expect((await own.run(owner.command, new AbortController().signal)).ok).toBe(true);
  const forged = createCloudPathPlanner({ client: outsider.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  expect(await forged.read(owner.command.runId)).toEqual({ ok: false, code: "not_found" });
  expect(await forged.cancel(owner.command.runId)).toEqual({ ok: false, code: "not_found" });
  expect(await forged.run({ ...owner.command, runId: randomUUID() }, new AbortController().signal)).toEqual({ ok: false, code: "not_found" });
  expect(model.doGenerateCalls).toHaveLength(1);
});

it("does not regenerate while the same run is active and rejects a second concurrent run", async () => {
  const owner = await fixture();
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<ReturnType<typeof providerReply>>();
  const model = new MockLanguageModelV4({ doGenerate: async () => { started.resolve(); return response.promise; } });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  const running = planner.run(owner.command, new AbortController().signal);
  try {
    await started.promise;
    expect(await planner.run(owner.command, new AbortController().signal)).toMatchObject({ ok: true, run: { status: "running" } });
    expect(await planner.run({ ...owner.command, runId: randomUUID() }, new AbortController().signal)).toEqual({ ok: false, code: "busy" });
  } finally { response.resolve(providerReply()); }
  expect(await running).toMatchObject({ ok: true, run: { status: "ready" } });
  expect(model.doGenerateCalls).toHaveLength(1);
});

it("discards a successful late draft after the user cancels but preserves known usage", async () => {
  const owner = await fixture();
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    const cancelled = await owner.client.rpc("cancel_path_planning", { p_run_id: owner.command.runId });
    expect(cancelled.error).toBeNull(); return providerReply();
  } });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  const result = await planner.run(owner.command, new AbortController().signal);
  expect(result).toMatchObject({ ok: true, run: { status: "cancelled", result: { status: "cancelled", usage: { totalTokens: 60 } } } });
  if (!result.ok) throw new Error("Expected cancelled run");
  expect(result.run.result).not.toHaveProperty("draft");
  expect(localSql(`select available_attempts from private.path_planning_quotas where owner_id='${owner.id}'`)).toBe("4");
  expect(await planner.run(owner.command, new AbortController().signal)).toEqual(result);
  expect(model.doGenerateCalls).toHaveLength(1);
});

it("marks the retained result stale if the actual Goal Brief changes during generation", async () => {
  const owner = await fixture();
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    const brief = await owner.client.from("goal_briefs").select("content").eq("id", owner.briefId).single();
    expect(brief.error).toBeNull();
    const changed = await owner.client.rpc("save_goal_brief", { p_id: owner.briefId, p_expected_revision: 1, p_confirm: false,
      p_content: { ...brief.data!.content, outcome: "准备另一个作品集" }, p_client_mutation_id: randomUUID() });
    expect(changed.error).toBeNull(); return providerReply();
  } });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  const result = await planner.run(owner.command, new AbortController().signal);
  expect(result).toMatchObject({ ok: true, run: { status: "stale", result: { status: "ready", source: { briefRevision: 1 } } } });
  expect(await planner.read(owner.command.runId)).toEqual(result);
});

it("retries only the exact storage completion after a real commit whose response is lost", async () => {
  const owner = await fixture(); let finishes = 0;
  const worker = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions, global: { fetch: async (request, init) => {
    const response = await fetch(request, init);
    if (String(request).endsWith("/rpc/finish_path_planning")) {
      finishes++;
      if (finishes === 1 && response.ok) { await response.text(); throw new Error("Simulated response loss after commit"); }
    }
    return response;
  } } });
  const model = new MockLanguageModelV4({ doGenerate: providerReply() });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: worker, actor: { userId: owner.id, client: "web" }, model });
  const result = await planner.run(owner.command, new AbortController().signal);
  expect(result).toMatchObject({ ok: true, run: { status: "ready" } });
  expect(finishes).toBe(2); expect(model.doGenerateCalls).toHaveLength(1);
  expect(await planner.read(owner.command.runId)).toEqual(result);
});

it("allows only one provider call when two identical starts actually race", async () => {
  const owner = await fixture();
  const model = new MockLanguageModelV4({ doGenerate: providerReply() });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  const responses = await Promise.all([planner.run(owner.command, new AbortController().signal), planner.run(owner.command, new AbortController().signal)]);
  for (const response of responses) {
    expect(response.ok).toBe(true);
    if (response.ok) expect(["running", "ready"]).toContain(response.run.status);
  }
  expect(await planner.read(owner.command.runId)).toMatchObject({ ok: true, run: { status: "ready" } });
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(localSql(`select available_attempts from private.path_planning_quotas where owner_id='${owner.id}'`)).toBe("4");
});

it("cannot claim work with user credentials and safely cancels that unclaimed reservation", async () => {
  const owner = await fixture();
  const model = new MockLanguageModelV4();
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: owner.client, actor: { userId: owner.id, client: "web" }, model });
  expect(await planner.run(owner.command, new AbortController().signal)).toEqual({ ok: false, code: "forbidden" });
  expect(await planner.cancel(owner.command.runId)).toMatchObject({ ok: true, run: { status: "cancelled", result: { providerMayHaveRun: false } } });
  expect(await planner.cancel(owner.command.runId)).toMatchObject({ ok: true, run: { status: "cancelled" } });
  expect(localSql(`select available_attempts from private.path_planning_quotas where owner_id='${owner.id}'`)).toBe("5");
  expect(model.doGenerateCalls).toHaveLength(0);
});

it("never calls a provider after an uncertain execution claim and recovers the expired record without retry", async () => {
  const owner = await fixture();
  const worker = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions, global: { fetch: async (request, init) => {
    const response = await fetch(request, init);
    if (String(request).endsWith("/rpc/claim_path_planning") && response.ok) {
      await response.text(); throw new Error("Simulated claim response loss after commit");
    }
    return response;
  } } });
  const model = new MockLanguageModelV4();
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: worker, actor: { userId: owner.id, client: "web" }, model });
  expect(await planner.run(owner.command, new AbortController().signal)).toEqual({ ok: false, code: "unavailable" });
  expect(await planner.run(owner.command, new AbortController().signal)).toMatchObject({ ok: true, run: { status: "running" } });
  // Move only this fixture's deadline; do not wait two minutes or alter the DB clock.
  localSql(`update public.path_planning_runs set expires_at=now()-interval '1 second' where id='${owner.command.runId}' and owner_id='${owner.id}';`);
  expect(await planner.read(owner.command.runId)).toMatchObject({ ok: true, run: { status: "interrupted", result: { status: "timed_out", usage: null } } });
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(localSql(`select available_attempts from private.path_planning_quotas where owner_id='${owner.id}'`)).toBe("4");
});

it("marks a previously ready run stale when read after a later source edit", async () => {
  const owner = await fixture();
  const model = new MockLanguageModelV4({ doGenerate: providerReply() });
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  const original = await planner.run(owner.command, new AbortController().signal);
  expect(original).toMatchObject({ ok: true, run: { status: "ready" } });
  const brief = await owner.client.from("goal_briefs").select("content").eq("id", owner.briefId).single();
  const changed = await owner.client.rpc("save_goal_brief", { p_id: owner.briefId, p_expected_revision: 1, p_confirm: false,
    p_content: { ...brief.data!.content, weeklyMinutes: 90 }, p_client_mutation_id: randomUUID() });
  expect(changed.error).toBeNull();
  const stale = await planner.read(owner.command.runId);
  expect(stale).toMatchObject({ ok: true, run: { status: "stale" } });
  if (!original.ok || !stale.ok) throw new Error("Expected retained result");
  expect(stale.run.result).toEqual(original.run.result);
  expect(await planner.run(owner.command, new AbortController().signal)).toEqual(stale);
  expect(model.doGenerateCalls).toHaveLength(1);
});

it("returns an unclaimed reservation if its confirmed source was edited before execution", async () => {
  const owner = await fixture(); const command = owner.command;
  const queued = await owner.client.rpc("begin_path_planning", { p_run_id: command.runId, p_brief_id: command.briefId,
    p_expected_brief_revision: 1, p_expected_blueprint_version: 0, p_start_date: command.startDate });
  expect(queued.error).toBeNull(); expect(queued.data.status).toBe("queued");
  const brief = await owner.client.from("goal_briefs").select("content").eq("id", owner.briefId).single();
  const changed = await owner.client.rpc("save_goal_brief", { p_id: owner.briefId, p_expected_revision: 1, p_confirm: false,
    p_content: brief.data!.content, p_client_mutation_id: randomUUID() });
  expect(changed.error).toBeNull();
  const model = new MockLanguageModelV4();
  const planner = createCloudPathPlanner({ client: owner.client, workerClient: admin, actor: { userId: owner.id, client: "web" }, model });
  expect(await planner.run(command, new AbortController().signal)).toMatchObject({ ok: true, run: { status: "failed",
    result: { status: "invalid_input", providerMayHaveRun: false, usage: null } } });
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(localSql(`select available_attempts from private.path_planning_quotas where owner_id='${owner.id}'`)).toBe("5");
});

it("returns the reservation when the caller cancels while preparing the unclaimed run", async () => {
  const owner = await fixture(); const controller = new AbortController(); let claims = 0;
  const session = await owner.client.auth.getSession();
  expect(session.data.session).not.toBeNull();
  const client = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: authOptions, global: {
    headers: { Authorization: `Bearer ${session.data.session!.access_token}` },
    fetch: async (request, init) => {
      const response = await fetch(request, init);
      if (String(request).endsWith("/rpc/begin_path_planning") && response.ok) {
        const body = await response.text();
        // Deliver the real, buffered receipt; cancel on the next I/O turn during preparation.
        setImmediate(() => controller.abort());
        return new Response(body, { status: response.status, headers: response.headers });
      }
      return response;
    },
  } });
  const worker = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: authOptions, global: { fetch: async (request, init) => {
    if (String(request).endsWith("/rpc/claim_path_planning")) claims++;
    return fetch(request, init);
  } } });
  const model = new MockLanguageModelV4();
  const planner = createCloudPathPlanner({ client, workerClient: worker, actor: { userId: owner.id, client: "web" }, model });
  const result = await planner.run(owner.command, controller.signal);
  expect(result).toMatchObject({ ok: true, run: { status: "cancelled", result: { providerMayHaveRun: false } } });
  expect(claims).toBe(0); expect(model.doGenerateCalls).toHaveLength(0);
  expect(localSql(`select available_attempts from private.path_planning_quotas where owner_id='${owner.id}'`)).toBe("5");
});
