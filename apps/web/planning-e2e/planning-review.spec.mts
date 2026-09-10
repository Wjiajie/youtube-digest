import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

for (const longText of [false, true]) {
test(`real local account recovers, reads and cancels planning across both themes (${longText ? "long text" : "ordinary text"})`, async ({ page, context }, testInfo) => {
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), email = `${id}@planning-ui.example.test`, password = randomUUID(), briefId = randomUUID();
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
    const title = longText ? "B".repeat(240) : "摄影作品路径";
    const content = { schemaVersion: 1, outcome: longText ? "A".repeat(240) : "制作一组摄影作品", startingPoint: "会使用相机", weeklyMinutes: 180, targetDate: null,
      constraints: "只在周末练习", successCriteria: "展示六张作品并写下取舍" };
    expect((await client.rpc("save_goal_brief", { p_id: briefId, p_expected_revision: 0, p_content: content, p_confirm: true, p_client_mutation_id: randomUUID() })).error).toBeNull();
    execFileSync("docker", ["exec", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
      `insert into private.path_planning_quotas(owner_id,available_attempts) values ('${id}',3);`], { stdio: "pipe" });
    const command = { runId: randomUUID(), briefId, expectedBriefRevision: 1, expectedBlueprintVersion: 0, startDate: new Date().toISOString().slice(0, 10) };
    // Fixture creation goes through the real run RPCs. SDK/provider execution is
    // independently covered by test:agent-runs, not simulated inside the website.
    const begun = await client.rpc("begin_path_planning", { p_run_id: command.runId, p_brief_id: briefId,
      p_expected_brief_revision: 1, p_expected_blueprint_version: 0, p_start_date: command.startDate });
    expect(begun.error).toBeNull();
    const instructions = await readFile(new URL("../src/lib/agent/skills/plan-path/v1/SKILL.md", import.meta.url), "utf8");
    const skill = { name: "blueprint-plan-path", version: "1.0.0", instructions, sha256: createHash("sha256").update(instructions).digest("hex") };
    const leaseId = randomUUID();
    expect((await admin.rpc("claim_path_planning", { p_owner_id: id, p_run_id: command.runId, p_lease_id: leaseId, p_skill: skill })).error).toBeNull();
    const shootId = randomUUID(), checkId = randomUUID();
    const draft = { ...begun.data.input_blueprint, goals: [{ id: randomUUID(), position: 0, title, description: "拍摄后挑选作品",
      stages: [{ id: randomUUID(), title: "拍摄与筛选", position: 0, nodes: [
        { id: shootId, position: 0, type: "practice", title: "拍摄同一主题", description: "尝试不同视角后整理照片", estimatedMinutes: 60, completionCriteria: "挑选六张并记录取舍", dependencyIds: [], resources: [] },
        { id: checkId, position: 1, type: "checkpoint", title: "检查照片取舍", description: "对照自己的判断记录改进", estimatedMinutes: 30, completionCriteria: "写出两项改进方向", dependencyIds: [shootId], resources: [] },
      ] }] }] };
    const finished = await admin.rpc("finish_path_planning", { p_owner_id: id, p_run_id: command.runId, p_lease_id: leaseId,
      p_result: { status: "ready", providerMayHaveRun: true, usage: { inputTokens: 20, outputTokens: 40, totalTokens: 60 }, draft,
        schedule: [{ nodeId: shootId, week: 1 }, { nodeId: checkId, week: 2 }], assumptions: ["周末可以集中练习"], skill,
        source: { runId: command.runId, briefId, briefRevision: 1, blueprintId: draft.id, blueprintVersion: 0, startDate: command.startDate } } });
    expect(finished.error).toBeNull(); expect(finished.data.status).toBe("ready");
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/goals/${briefId}`);
    await page.getByRole("link", { name: "查看规划记录", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("link", { name: "查看这次规划", exact: true }).click();
    await expect(page.getByRole("heading", { name: "草案已保存", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "拍摄同一主题", exact: true })).toBeVisible();
    await expect(page.getByText("先完成：拍摄同一主题", { exact: true })).toBeVisible();
    await expect(page.getByText("60 / 180 分钟", { exact: true })).toBeVisible();
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await context.setOffline(true); await page.getByRole("button", { name: "刷新运行状态", exact: true }).click();
    await expect(page.getByText("下面保留的内容不是最新状态", { exact: false })).toBeVisible();
    await context.setOffline(false); await page.getByRole("button", { name: "刷新运行状态", exact: true }).click();
    await expect(page.getByText("下面保留的内容不是最新状态", { exact: false })).toHaveCount(0);
    const queuedId = randomUUID();
    expect((await client.rpc("begin_path_planning", { p_run_id: queuedId, p_brief_id: briefId, p_expected_brief_revision: 1, p_expected_blueprint_version: 0, p_start_date: command.startDate })).error).toBeNull();
    await page.goto(`/planning/${queuedId}`); await page.getByRole("button", { name: "取消本次规划", exact: true }).click();
    await expect(page.getByRole("heading", { name: "已取消", exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole("heading", { name: "已取消", exact: true })).toBeVisible();
    await page.goto(`/planning/${command.runId}`);
    await expect(page.getByRole("button", { name: "确认并应用", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "准备确认提案", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认并应用", exact: true })).toBeEnabled();
    expect((await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id })).data.goals).toEqual([]);
    await page.reload(); await expect(page.getByRole("button", { name: "确认并应用", exact: true })).toBeEnabled();
    if (!longText) {
      await page.getByRole("button", { name: "确认并应用", exact: true }).click();
      await expect(page.getByRole("heading", { name: "已写入正式蓝图 v1", exact: true })).toBeVisible();
      await page.reload(); await expect(page.getByRole("heading", { name: "已写入正式蓝图 v1", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "查看正式路径", exact: true }).click();
      await expect(page.getByRole("link", { name: new RegExp("摄影作品路径") })).toBeVisible();
    }
    expect((await client.rpc("save_goal_brief", { p_id: briefId, p_expected_revision: 1, p_content: { ...content, weeklyMinutes: 90 }, p_confirm: false, p_client_mutation_id: randomUUID() })).error).toBeNull();
    await page.goto(`/planning/${command.runId}`); await expect(page.getByRole("heading", { name: "来源已变化", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    if (longText) {
      await expect(page.getByRole("button", { name: "确认并应用", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "拒绝这份提案", exact: true }).click();
      await expect(page.getByRole("heading", { name: "已拒绝这份提案", exact: true })).toBeVisible();
      await page.reload(); await expect(page.getByRole("heading", { name: "已拒绝这份提案", exact: true })).toBeVisible();
      expect((await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id })).data.goals).toEqual([]);
    } else {
      await expect(page.getByRole("heading", { name: "已写入正式蓝图 v1", exact: true })).toBeVisible();
      expect((await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id })).data.version).toBe(1);
    }
    await page.screenshot({ path: testInfo.outputPath("approval-recovered.png"), fullPage: true });
    expect(errors).toEqual([]);
    await context.clearCookies(); await page.reload(); await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  } finally {
    await context.setOffline(false); await context.clearCookies(); await client.auth.signOut().catch(() => {});
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    console.log("Removed only this test's local planning account and cascaded records; no email or live provider call.");
  }
});
}
