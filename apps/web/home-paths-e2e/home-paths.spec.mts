import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("real personal home projects confirmed paths and preserves historical outcomes", async ({ page, context }, testInfo) => {
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), email = `${id}@home-paths.example.test`, password = randomUUID();
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, { cookies: {
    getAll: () => cookies, setAll: entries => { for (const entry of entries) {
      const index = cookies.findIndex(item => item.name === entry.name);
      if (index < 0) cookies.push(entry); else cookies[index] = entry;
    } },
  } });
  const created = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
  expect(created.error).toBeNull(); expect(created.data.user?.id).toBe(id);
  try {
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    for (let attempt = 0; attempt < 6; attempt++) {
      const probe = await client.rpc("read_node_status_workspace", { p_owner_id: id });
      if (!probe.error) break;
      if (probe.error.code !== "PGRST303" || probe.error.message !== "JWT issued at future" || attempt === 5) throw new Error(`Local readiness failed: ${probe.error.code}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "我的蓝图", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加目标", exact: true })).toHaveCount(0);
    const first = await client.rpc("read_node_status_workspace", { p_owner_id: id });
    expect(first.error).toBeNull();
    const practiceId = randomUUID(), checkpointId = randomUUID(), goalId = randomUUID();
    const blueprint = { ...first.data.blueprint, goals: [{ id: goalId, title: "自信完成公开演讲", position: 0,
      description: "从录制练习到接受反馈，让每一步都留下真实作品。",
      stages: [{ id: randomUUID(), title: "第一周 · 建立表达基础", position: 0, nodes: [
        { id: practiceId, title: "录制三分钟演讲", type: "practice", position: 0, dependencyIds: [], resources: [], estimatedMinutes: 45, completionCriteria: "录制一段视频，标记三个改进点" },
        { id: checkpointId, title: "邀请听众反馈", type: "checkpoint", position: 1, dependencyIds: [practiceId], resources: [], estimatedMinutes: 30, completionCriteria: "获得两位听众的具体反馈" },
      ] }, { id: randomUUID(), title: "第二周 · 复盘与巩固", position: 1, nodes: [] }] },
      ...Array.from({ length: 5 }, (_, index) => ({ id: randomUUID(), title: `探索目标 ${index + 2}`, position: index + 1, stages: [] })),
    ] };
    async function apply() {
      const proposalId = randomUUID();
      expect((await client.from("blueprint_proposals").insert({ id: proposalId, owner_id: id, blueprint_id: blueprint.id,
        base_version: blueprint.version, proposed_snapshot: blueprint, client_mutation_id: randomUUID() })).error).toBeNull();
      expect((await client.rpc("apply_blueprint_proposal", { proposal_id: proposalId,
        expected_version: blueprint.version, mutation_id: randomUUID() })).error).toBeNull();
      blueprint.version++;
    }
    await apply();
    expect((await client.rpc("record_progress_evidence", { p_node_id: practiceId, p_expected_version: 1,
      p_evidence_text: "今天完成第一次录制，发现开场可以更简洁。", p_artifact_url: null, p_client_mutation_id: randomUUID() })).error).toBeNull();
    expect((await client.rpc("confirm_node_status", { p_node_id: practiceId, p_expected_version: 1,
      p_expected_status_revision: 0, p_status: "completed", p_evidence_id: null, p_client_mutation_id: randomUUID() })).error).toBeNull();
    await page.reload();
    await expect(page.getByText("今天完成第一次录制，发现开场可以更简洁。", { exact: true })).toBeVisible();
    await expect(page.getByText("邀请听众反馈", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("探索目标 6", { exact: true })).toHaveCount(0);
    const otherFocus = page.getByRole("button", { name: "关注目标：探索目标 2", exact: true });
    await otherFocus.click();
    await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption("eastern");
    await expect(otherFocus).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "当前重点" }).getByRole("heading", { name: "等待规划" })).toBeVisible();
    await page.getByRole("button", { name: "关注目标：自信完成公开演讲", exact: true }).click();
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-home-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const focusBox = await page.getByRole("region", { name: "当前重点" }).boundingBox();
      const identityBox = await page.getByRole("region", { name: "个人身份静态回退" }).boundingBox();
      expect(focusBox!.y).toBeLessThan(identityBox!.y);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-home-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole("navigation", { name: "蓝图导航" }).getByRole("link", { name: "全部目标", exact: true }).click();
    await expect(page.getByText("探索目标 6", { exact: true })).toBeVisible();
    await page.goto(`/paths/${goalId}?node=${checkpointId}`);
    await expect(page.getByRole("heading", { name: "自信完成公开演讲", exact: true })).toBeVisible();
    await expect(page.getByText("获得两位听众的具体反馈", { exact: true })).toBeVisible();
    await expect(page.getByText("第二周 · 复盘与巩固", { exact: true })).toBeVisible();
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-path-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-path-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    // Formal edit changes current criteria, but never rewrites historical evidence/status.
    blueprint.goals[0].stages[0].nodes[0].completionCriteria = "新增依据：不看稿完成录制";
    await apply();
    await page.goto("/");
    await expect(page.getByText(/待复核/).first()).toBeVisible();
    await expect(page.getByText("新增依据：不看稿完成录制", { exact: true })).toBeVisible();
    blueprint.goals[0].stages[0].nodes = [];
    await apply();
    await page.reload();
    await expect(page.getByText("今天完成第一次录制，发现开场可以更简洁。", { exact: true })).toBeVisible();
    await expect(page.getByText(/历史记录/).first()).toBeVisible();
    await expect(page.locator(`a[href*="node=${practiceId}"]`)).toHaveCount(0);
    await page.goto("/blueprint/edit");
    await expect(page.getByRole("button", { name: "添加目标", exact: true })).toBeVisible();
    await expect(page.getByText("一份属于你的目标蓝图 · 版本 3", { exact: true })).toBeVisible();
    const unavailable = await page.goto(`/paths/${randomUUID()}`);
    expect(unavailable?.status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([context.clearCookies(), client.auth.signOut()]);
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    console.info("Removed only this run's local account and cascaded home/path fixtures; no email sent.");
  }
});
