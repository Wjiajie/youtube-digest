import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";
import { createBlueprintApplication } from "@blueprint/domain";
import { createSupabaseBlueprintStore } from "../src/lib/supabase/store";

for (const existingNodes of [0, 70]) test(`a real account generates, reviews and confirms with ${existingNodes} existing nodes`, async ({ page: originalPage, context }, testInfo) => {
  let page = originalPage;
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const extraAccounts: { id: string; client: ReturnType<typeof createClient> }[] = [];
  const id = randomUUID(), email = `${id}@planning-generation.example.test`, password = randomUUID(), briefId = randomUUID();
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: entries => {
    for (const entry of entries) { const index = cookies.findIndex(item => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry; }
  } } });
  expect((await admin.auth.admin.createUser({ id, email, password, email_confirm: true })).error).toBeNull();
  try {
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    for (let attempt = 0; attempt < 6; attempt++) {
      const ready = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
      if (!ready.error) break;
      if (ready.error.code !== "PGRST303" || attempt === 5) throw new Error(`Read readiness: ${ready.error.code}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect((await client.rpc("save_goal_brief", { p_id: briefId, p_expected_revision: 0, p_confirm: true, p_client_mutation_id: randomUUID(),
      p_content: { schemaVersion: 1, outcome: "制作摄影作品", startingPoint: "会用相机", weeklyMinutes: 180,
        targetDate: null, constraints: "周末练习", successCriteria: "六张照片与取舍记录" } })).error).toBeNull();
    if (existingNodes) {
      const store = createSupabaseBlueprintStore(client), current = await store.getMainBlueprint(id);
      if (!current) throw new Error("Missing test Blueprint");
      const draft = { ...current, goals: [{ id: randomUUID(), title: "保留的既有路径", position: 0, stages: [{ id: randomUUID(), title: "已有练习", position: 0,
        nodes: Array.from({ length: existingNodes }, (_, position) => ({ id: randomUUID(), type: "practice" as const, title: `旧节点 ${position}`, position,
          estimatedMinutes: 10, completionCriteria: "A".repeat(4000), dependencyIds: [], resources: [] })) }] }] };
      expect(Buffer.byteLength(JSON.stringify(draft))).toBeGreaterThan(256 * 1024);
      const app = createBlueprintApplication({ store, newId: randomUUID, now: () => new Date() });
      const actor = { userId: id, client: "web" as const };
      const proposal = await app.createProposal(actor, { draft, baseVersion: 0, clientMutationId: randomUUID() });
      if (!proposal.ok) throw new Error("Cannot save valid existing path");
      expect((await app.applyProposal(actor, { proposalId: proposal.value.id, expectedVersion: 0, clientMutationId: randomUUID() })).ok).toBe(true);
    }
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    const command = { accountId: id, runId: randomUUID(), briefId, expectedBriefRevision: 1, expectedBlueprintVersion: existingNodes ? 1 : 0, startDate: new Date().toISOString().slice(0, 10) };
    const accessToken = (await client.auth.getSession()).data.session!.access_token;
    const edgeUrl = `${local.API_URL}/functions/v1/planning-worker`;
    const edgeHeaders = { Authorization: `Bearer ${accessToken}`, "x-blueprint-worker-secret": "local-only-planning-worker-fixture-secret-32" };
    const edgeBody = { operation: "finish", runId: randomUUID(), leaseId: randomUUID(),
      result: { status: "cancelled", providerMayHaveRun: false, usage: null } };
    expect((await context.request.post(edgeUrl, { data: edgeBody })).status()).toBe(403);
    expect((await context.request.post(edgeUrl, { headers: { Authorization: edgeHeaders.Authorization }, data: edgeBody })).status()).toBe(403);
    expect((await context.request.post(edgeUrl, { headers: { ...edgeHeaders, Authorization: "Bearer forged" }, data: edgeBody })).status()).toBe(401);
    const tokenParts = accessToken.split(".");
    tokenParts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(tokenParts[1], "base64url").toString()), sub: randomUUID() })).toString("base64url");
    expect((await context.request.post(edgeUrl, { headers: { ...edgeHeaders, Authorization: `Bearer ${tokenParts.join(".")}` }, data: edgeBody })).status()).toBe(401);
    expect((await context.request.post(edgeUrl, { headers: edgeHeaders, data: { ...edgeBody, extra: "x".repeat(8 * 1024 * 1024) } })).status()).toBe(413);
    expect((await context.request.post(edgeUrl, { headers: edgeHeaders, data: { ...edgeBody, ownerId: id } })).status()).toBe(422);
    expect((await context.request.post(edgeUrl, { headers: edgeHeaders, data: { operation: "apply_blueprint_proposal", runId: command.runId } })).status()).toBe(422);
    expect((await context.request.post(edgeUrl, { headers: edgeHeaders, data: edgeBody })).status()).toBe(404);
    const request = async (data: object, origin = "http://127.0.0.1:3100") => context.request.post("http://127.0.0.1:3100/api/planning/runs", { headers: { origin }, data });
    expect((await request(command, "https://outside.example")).status()).toBe(403);
    expect((await request({ ...command, accountId: randomUUID() })).status()).toBe(403);
    expect((await request({ ...command, draft: {} })).status()).toBe(422);
    expect((await context.request.post("http://127.0.0.1:3100/api/planning/runs", { headers: { origin: "http://127.0.0.1:3100", "Content-Type": "application/json" }, data: "{" })).status()).toBe(422);
    expect((await request({ ...command, extra: "x".repeat(3000) })).status()).toBe(413);
    expect((await request(command)).status()).toBe(429);
    expect((await client.from("path_planning_runs").select("id")).data).toEqual([]);
    execFileSync("docker", ["exec", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `insert into private.path_planning_quotas(owner_id,available_attempts) values ('${id}',1) on conflict(owner_id) do update set available_attempts=1;`], { stdio: "pipe" });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/goals/${briefId}/planning`);
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-start.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const completed = page.waitForResponse(response => response.url().endsWith("/api/planning/runs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "生成路径建议", exact: true }).click();
    const opened = context.waitForEvent("page");
    await page.getByRole("link", { name: "查看本次规划", exact: true }).click();
    page = await opened;
    expect(originalPage.url()).toContain(`/goals/${briefId}/planning`);
    expect((await completed).status()).toBe(200);
    page.on("pageerror", error => errors.push(error.message));
    await page.waitForLoadState("domcontentloaded"); await page.reload();
    await expect(page.getByRole("heading", { name: "草案已保存", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "完成六张照片", exact: true })).toBeVisible();
    const runs = await client.from("path_planning_runs").select("id,skill,status");
    expect(runs.error).toBeNull(); expect(runs.data).toHaveLength(1); expect(runs.data![0].skill.instructions).toContain("# 可审阅路径规划");
    const outsiderId = randomUUID(), outsiderPassword = randomUUID(), outsiderEmail = `${outsiderId}@planning-generation.example.test`;
    expect((await admin.auth.admin.createUser({ id: outsiderId, email: outsiderEmail, password: outsiderPassword, email_confirm: true })).error).toBeNull();
    const outsider = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    extraAccounts.push({ id: outsiderId, client: outsider });
    expect((await outsider.auth.signInWithPassword({ email: outsiderEmail, password: outsiderPassword })).error).toBeNull();
    const outsiderToken = (await outsider.auth.getSession()).data.session!.access_token;
    expect((await context.request.post(edgeUrl, { headers: { ...edgeHeaders, Authorization: `Bearer ${outsiderToken}` },
      data: { ...edgeBody, runId: runs.data![0].id } })).status()).toBe(404);
    expect((await client.rpc("read_path_planning", { p_run_id: runs.data![0].id })).data.status).toBe("ready");
    const replay = await request({ ...command, runId: runs.data![0].id });
    expect(replay.status()).toBe(200); expect((await replay.json()).status).toBe("ready");
    expect((await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id })).data.goals).toHaveLength(existingNodes ? 1 : 0);
    await page.getByRole("button", { name: "准备确认提案", exact: true }).click();
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByRole("heading", { name: `已写入正式蓝图 v${existingNodes ? 2 : 1}`, exact: true })).toBeVisible();
    const formal = (await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id })).data;
    if (existingNodes) expect(formal.goals[0].stages[0].nodes.every((node: { completionCriteria: string }) => node.completionCriteria === "A".repeat(4000))).toBe(true);
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-confirmed.png`), fullPage: !existingNodes });
    }
    await page.goto(`/goals/${briefId}/planning`);
    await expect(page.getByText("制作摄影作品", { exact: true })).toBeVisible();
    await context.clearCookies();
    await page.getByRole("button", { name: "生成路径建议", exact: true }).click();
    await expect(page.getByRole("link", { name: "重新登录", exact: true })).toBeVisible();
    await expect(page.getByText("制作摄影作品", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "查看这次规划", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    for (const extra of extraAccounts) {
      await extra.client.auth.signOut().catch(() => {});
      expect((await admin.auth.admin.deleteUser(extra.id)).error).toBeNull();
    }
    await context.clearCookies(); await client.auth.signOut().catch(() => {});
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
  }
});
