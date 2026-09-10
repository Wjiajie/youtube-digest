import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createBlueprintApplication } from "@blueprint/domain";
import { createSupabaseBlueprintStore } from "../src/lib/supabase/store";

const local = localSupabaseTestConfig(), origin = "http://127.0.0.1:3100";
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts: { id: string; client: ReturnType<typeof createServerClient> }[] = [];
const disabled = process.env.BLUEPRINT_RESOURCE_ENTRY_TEST_DISABLED === "true";
async function account(context?: BrowserContext) {
  const id = randomUUID(), email = `${id}@resource-entry.example.test`, password = randomUUID();
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: entries => {
    for (const entry of entries) { const index = cookies.findIndex(item => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry; }
  } } });
  expect((await admin.auth.admin.createUser({ id, email, password, email_confirm: true })).error).toBeNull();
  accounts.push({ id, client });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  for (let attempt = 0; attempt < 6; attempt++) {
    const ready = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
    if (!ready.error) break;
    if (ready.error.code !== "PGRST303" || attempt === 5) throw new Error(`Read readiness: ${ready.error.code}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (context) await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: origin, sameSite: "Lax" as const })));
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Missing fixture session");
  return { id, client, token };
}
test.afterEach(async ({ context }) => {
  await context.clearCookies();
  for (const owner of accounts.splice(0)) {
    await owner.client.auth.signOut(); expect((await admin.auth.admin.deleteUser(owner.id)).error).toBeNull();
  }
});

test(disabled ? "disabled resource entry keeps a real signed-in account from reserving or calling providers" : "real Cookie → Next production → verified Edge → DB → provider HTTP completes three explicit stages without replay consumption", async ({ context, page }) => {
  const owner = await account(context), nodeId = randomUUID();
  const store = createSupabaseBlueprintStore(owner.client), current = await store.getMainBlueprint(owner.id);
  if (!current) throw new Error("Missing fixture Blueprint");
  const draft = { ...current, goals: [{ id: randomUUID(), title: "摄影作品", position: 0, stages: [{ id: randomUUID(), title: "基础曝光", position: 0,
    nodes: [{ id: nodeId, title: "曝光组合", type: "learn" as const, position: 0, estimatedMinutes: 30, completionCriteria: "拍摄三组对比照片", dependencyIds: [], resources: [] }] }] }] };
  const app = createBlueprintApplication({ store, newId: randomUUID, now: () => new Date() });
  const actor = { userId: owner.id, client: "web" as const };
  const proposal = await app.createProposal(actor, { draft, baseVersion: 0, clientMutationId: randomUUID() });
  if (!proposal.ok) throw new Error("Missing fixture proposal");
  expect((await app.applyProposal(actor, { proposalId: proposal.value.id, expectedVersion: 0, clientMutationId: randomUUID() })).ok).toBe(true);
  const command = { accountId: owner.id, kind: "discover", runId: randomUUID(), nodeId, expectedBlueprintVersion: 1,
    preferences: { regionCode: "US", language: "zh", allowLanguageFallback: true, maxDurationSeconds: 1800, publishedAfter: null },
    learnerContext: { startingPoint: "只会自动模式", constraints: null } };
  const request = (data: object, headers: Record<string, string> = {}) => context.request.post(`${origin}/api/resources/runs`, { headers: { origin, ...headers }, data });
  const calls = async () => (await context.request.get("http://127.0.0.1:3166/fixture/calls")).json();
  await context.request.post("http://127.0.0.1:3166/fixture/reset");
  if (disabled) {
    const response = await request(command);
    expect(response.status()).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "disabled" });
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect((await owner.client.from("resource_runs").select("id")).data).toEqual([]);
    expect(await calls()).toEqual([]);
    await page.goto(`${origin}/resources/nodes/${nodeId}`);
    await expect(page.getByRole("button", { name: "查找视频", exact: true })).toBeDisabled();
    // A previously queued operation remains readable/cancellable while execution is off.
    execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: `insert into private.resource_quotas(owner_id,kind,available_attempts) values ('${owner.id}','discover',1);`, stdio: "pipe",
    });
    const { accountId: _accountId, ...queued } = command;
    expect((await owner.client.rpc("begin_resource_run", { p_request: queued })).error).toBeNull();
    await page.goto(`${origin}/resources/${queued.runId}`);
    await page.getByRole("button", { name: "取消本次运行", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消本次运行", exact: true })).toHaveCount(0);
    expect((await owner.client.rpc("read_resource_run", { p_run_id: queued.runId })).data.status).toBe("cancelled");
    expect(await calls()).toEqual([]); return;
  }
  expect((await request(command, { origin: "https://outside.example" })).status()).toBe(403);
  expect((await request(command, { authorization: `Bearer ${owner.token}` })).status()).toBe(403);
  expect((await request({ ...command, accountId: randomUUID() })).status()).toBe(403);
  expect((await request({ ...command, jobId: "client-chosen-job" })).status()).toBe(422);
  expect((await request({ ...command, learnerContext: { ...command.learnerContext, constraints: "大".repeat(12000) } })).status()).toBe(413);
  const corruptText = JSON.stringify({ ...command, learnerContext: { ...command.learnerContext, startingPoint: "UTF8_MARKER" } }).split("UTF8_MARKER");
  const corruptBody = Buffer.concat([Buffer.from(corruptText[0]), Buffer.from([255]), Buffer.from(corruptText[1])]);
  expect((await context.request.post(`${origin}/api/resources/runs`, { headers: { origin, "content-type": "application/json" }, data: corruptBody })).status()).toBe(422);
  expect((await context.request.post(`${origin}/api/resources/runs`, { headers: { origin, "content-type": "application/json" }, data: "{" })).status()).toBe(422);
  expect((await request(command)).status()).toBe(429);
  expect(await calls()).toEqual([]);
  expect((await owner.client.from("resource_runs").select("id")).data).toEqual([]);
  // Allowance only for this disposable account, never a real user's quota.
  execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `insert into private.resource_quotas(owner_id,kind,available_attempts) values ('${owner.id}','discover',1),('${owner.id}','captions',1),('${owner.id}','match',1);`, stdio: "pipe",
  });
  const discovered = await request(command);
  expect(discovered.status()).toBe(200); expect(await discovered.json()).toEqual({ ok: true, runId: command.runId, status: "ready" });
  expect(discovered.headers()["cache-control"]).toBe("private, no-store");
  const read = async (id: string) => {
    const receipt = await owner.client.rpc("read_resource_run", { p_run_id: id }); expect(receipt.error).toBeNull(); return receipt.data;
  };
  expect((await read(command.runId)).result).toMatchObject({ status: "discovered", candidates: [{ transcript: { status: "pending", jobId: "resource-entry-native-job" } }] });
  const captions = { kind: "captions", runId: randomUUID(), sourceRunId: command.runId, accountId: owner.id };
  const checked = await request(captions);
  expect(checked.status()).toBe(200); expect(await checked.json()).toEqual({ ok: true, runId: captions.runId, status: "ready" });
  expect((await read(captions.runId)).result).toMatchObject({ candidates: [{ transcript: { status: "ready", language: "en" }, eligibleForMatching: true }] });
  const match = { kind: "match", runId: randomUUID(), sourceRunId: captions.runId, accountId: owner.id };
  const matched = await request(match);
  expect(matched.status()).toBe(200); expect(await matched.json()).toEqual({ ok: true, runId: match.runId, status: "ready" });
  const saved = await read(match.runId);
  expect(saved.skill.instructions).toContain("Match Resources to a Learning Path Node");
  expect(saved.result).toMatchObject({ status: "matched", reviewRequired: true, source: { blueprintVersion: 1, nodeId },
    assessments: [{ videoId: "abcdefghijk", evidence: [{ segmentIndex: 0, offsetMs: 1500, quote: "Compare aperture and shutter speed." }] }] });
  for (const previous of [command, captions, match]) expect((await request(previous)).status()).toBe(200);
  expect(await calls()).toEqual([{ path: "/youtube/v3/search", method: "GET" }, { path: "/youtube/v3/videos", method: "GET" },
    { path: "/v1/transcript", method: "GET" }, { path: "/v1/transcript/resource-entry-native-job", method: "GET" }, { path: "/chat/completions", method: "POST" }]);
  expect((await store.getMainBlueprint(owner.id))?.version).toBe(1);

  const edgeUrl = `${local.API_URL}/functions/v1/resource-worker`, edgeBody = { operation: "claim", runId: command.runId, leaseId: randomUUID(), skill: null };
  const edgeHeaders = { Authorization: `Bearer ${owner.token}`, "x-blueprint-worker-secret": "local-only-resource-worker-fixture-secret-32" };
  expect((await context.request.post(edgeUrl, { data: edgeBody })).status()).toBe(403);
  expect((await context.request.post(edgeUrl, { headers: { Authorization: edgeHeaders.Authorization }, data: edgeBody })).status()).toBe(403);
  expect((await context.request.post(edgeUrl, { headers: { ...edgeHeaders, "x-blueprint-worker-secret": "local-only-planning-worker-fixture-secret-32" }, data: edgeBody })).status()).toBe(403);
  expect((await context.request.post(edgeUrl, { headers: { ...edgeHeaders, Authorization: "Bearer forged" }, data: edgeBody })).status()).toBe(401);
  const tokenParts = owner.token.split(".");
  tokenParts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(tokenParts[1], "base64url").toString()), sub: randomUUID() })).toString("base64url");
  expect((await context.request.post(edgeUrl, { headers: { ...edgeHeaders, Authorization: `Bearer ${tokenParts.join(".")}` }, data: edgeBody })).status()).toBe(401);
  expect((await context.request.post(edgeUrl, { headers: edgeHeaders, data: { ...edgeBody, ownerId: owner.id } })).status()).toBe(422);
  const stranger = await account();
  expect((await context.request.post(edgeUrl, { headers: { ...edgeHeaders, Authorization: `Bearer ${stranger.token}` }, data: edgeBody })).status()).toBe(404);
  expect((await read(command.runId)).status).toBe("ready");
  await context.clearCookies();
  expect((await request(match)).status()).toBe(401);
});

test("a stalled authenticated upload reaches its deadline without reserving an operation", async ({ context }) => {
  const owner = await account(context);
  const cookie = (await context.cookies(origin)).map(item => `${item.name}=${item.value}`).join("; ");
  await context.request.post("http://127.0.0.1:3166/fixture/reset");
  const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const request = httpRequest(`${origin}/api/resources/runs`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" } }, response => {
      let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; });
      response.on("end", () => { request.destroy(); resolve({ status: response.statusCode, body }); });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(15000, () => { request.destroy(); reject(new Error("Stalled fixture request exceeded test deadline")); });
    request.write("{"); // Deliberately no end: the server owns the read deadline.
  });
  expect(response.status).toBe(408);
  expect(JSON.parse(response.body)).toEqual({ ok: false, code: "invalid" });
  expect((await owner.client.from("resource_runs").select("id")).data).toEqual([]);
  expect(await (await context.request.get("http://127.0.0.1:3166/fixture/calls")).json()).toEqual([]);
});

for (const theme of ["cyberpunk", "eastern"] as const) test(`resource workbench ${theme}: real node → discovery → captions → matching → recover and cancel`, async ({ page, context }, testInfo) => {
  test.skip(disabled, "The separate off-switch test verifies disabled execution; this journey explicitly enables fixtures.");
  const owner = await account(context), actor = { userId: owner.id, client: "web" as const };
  const store = createSupabaseBlueprintStore(owner.client), current = await store.getMainBlueprint(owner.id);
  if (!current) throw new Error("Missing Blueprint");
  const nodeId = randomUUID(), goalId = randomUUID();
  const app = createBlueprintApplication({ store, newId: randomUUID, now: () => new Date() });
  const proposed = await app.createProposal(actor, { baseVersion: 0, clientMutationId: randomUUID(), draft: { ...current,
    goals: [{ id: goalId, title: "用照片讲一个真实的故事", position: 0, stages: [{ id: randomUUID(), title: "掌握光线与曝光", position: 0,
      nodes: [{ id: nodeId, title: "比较光圈与快门的组合", type: "learn", position: 0, estimatedMinutes: 30,
        description: "在同一场景拍摄，观察主体与背景的变化。", completionCriteria: "提交三组照片，解释参数取舍。", dependencyIds: [], resources: [] }] }] }] } });
  if (!proposed.ok) throw new Error("Missing proposal");
  expect((await app.applyProposal(actor, { proposalId: proposed.value.id, expectedVersion: 0, clientMutationId: randomUUID() })).ok).toBe(true);
  execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `insert into private.resource_quotas(owner_id,kind,available_attempts) values ('${owner.id}','discover',3),('${owner.id}','captions',1),('${owner.id}','match',1);`, stdio: "pipe",
  });
  const errors: string[] = []; context.on("page", tab => tab.on("pageerror", error => errors.push(error.message)));
  page.on("pageerror", error => errors.push(error.message));
  await context.request.post("http://127.0.0.1:3166/fixture/reset");
  await page.goto(`${origin}/paths/${goalId}`);
  if (theme === "eastern") {
    await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
    await page.getByRole("button", { name: "保存到账号", exact: true }).click();
    await expect(page.getByText("主题已保存到账号。扩展将在重新读取时跟随。", { exact: true })).toBeVisible();
  }
  await page.getByRole("link", { name: "查找与审阅学习资源" }).click();
  await expect(page.locator("[data-bp-theme]").first()).toHaveAttribute("data-bp-theme", theme);
  await expect(page.getByRole("button", { name: "查找视频", exact: true })).toBeVisible();
  expect(await (await context.request.get("http://127.0.0.1:3166/fixture/calls")).json()).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`${theme}-node-wide.png`), fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${theme}-node-narrow.png`), fullPage: true });
  await page.getByLabel("观看地区代码", { exact: true }).fill("US");
  await page.getByLabel("允许使用其他语言的原生字幕", { exact: true }).check();
  const submitted = page.waitForResponse(response => response.url().endsWith("/api/resources/runs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "查找视频", exact: true }).click();
  expect((await submitted).status()).toBe(200);
  const openRecord = async (from: typeof page) => {
    const popup = context.waitForEvent("page");
    await from.getByRole("link", { name: "打开本次运行记录", exact: true }).click();
    const opened = await popup; await opened.waitForLoadState("domcontentloaded"); return opened;
  };
  const discoveryPage = await openRecord(page);
  await expect(discoveryPage.getByRole("button", { name: "读取待处理字幕", exact: true })).toBeEnabled();
  expect(await discoveryPage.content()).not.toContain("resource-entry-native-job");
  const continueRequest = discoveryPage.waitForResponse(response => response.url().endsWith("/api/resources/runs") && response.request().method() === "POST");
  await discoveryPage.getByRole("button", { name: "读取待处理字幕", exact: true }).click();
  expect((await continueRequest).status()).toBe(200);
  const captionPage = await openRecord(discoveryPage);
  const matchingRequest = captionPage.waitForResponse(response => response.url().endsWith("/api/resources/runs") && response.request().method() === "POST");
  await captionPage.getByRole("button", { name: "生成匹配建议", exact: true }).click();
  expect((await matchingRequest).status()).toBe(200);
  const matchPage = await openRecord(captionPage);
  await expect(matchPage.getByText("Compare aperture and shutter speed.", { exact: true })).toBeVisible();
  await expect(matchPage.locator("[data-bp-theme]").first()).toHaveAttribute("data-bp-theme", theme);
  expect(await matchPage.content()).not.toContain("Match Resources to a Learning Path Node");
  await matchPage.setViewportSize({ width: 1440, height: 1000 });
  await matchPage.screenshot({ path: testInfo.outputPath(`${theme}-match-wide.png`), fullPage: true });
  await matchPage.setViewportSize({ width: 320, height: 900 });
  expect(await matchPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await matchPage.screenshot({ path: testInfo.outputPath(`${theme}-match-narrow.png`), fullPage: true });
  await matchPage.getByRole("button", { name: "读取最新状态", exact: true }).click();
  await discoveryPage.reload();
  await expect(discoveryPage.getByRole("button", { name: "读取待处理字幕", exact: true })).toHaveCount(0);
  await expect(discoveryPage.getByRole("link", { name: "查看已有后续运行", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(`a[href="${new URL(matchPage.url()).pathname}"]`)).toHaveCount(1);
  const queued = randomUUID();
  expect((await owner.client.rpc("begin_resource_run", { p_request: { kind: "discover", runId: queued, nodeId, expectedBlueprintVersion: 1,
    preferences: { regionCode: "US", language: "zh", allowLanguageFallback: true, maxDurationSeconds: 1800, publishedAfter: null }, learnerContext: { startingPoint: null, constraints: null } } })).error).toBeNull();
  await page.goto(`${origin}/resources/${queued}`);
  await page.getByRole("button", { name: "取消本次运行", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消本次运行", exact: true })).toHaveCount(0);
  expect((await owner.client.rpc("read_resource_run", { p_run_id: queued })).data.status).toBe("cancelled");
  expect((await store.getMainBlueprint(owner.id))?.version).toBe(1);
  expect(await (await context.request.get("http://127.0.0.1:3166/fixture/calls")).json()).toHaveLength(5);
  await account(context);
  await matchPage.getByRole("button", { name: "读取最新状态", exact: true }).click();
  await expect(matchPage.getByRole("heading", { name: "比较光圈与快门的组合", exact: true })).toHaveCount(0);
  await expect(matchPage.getByText("Compare aperture and shutter speed.", { exact: true })).toHaveCount(0);
  expect((await owner.client.rpc("read_resource_run", { p_run_id: queued })).data.status).toBe("cancelled");
  expect(errors).toEqual([]);
});
