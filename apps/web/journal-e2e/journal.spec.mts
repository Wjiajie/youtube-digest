import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("real local account records a private outcome, retains an offline draft and changes both themes", async ({ page, context }, testInfo) => {
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), email = `${id}@journal.example.test`, password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
  expect(error).toBeNull();
  expect(data.user?.id).toBe(id);
  try {
    const cookies: { name: string; value: string }[] = [];
    const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, { cookies: {
      getAll: () => cookies,
      setAll: (entries) => { for (const entry of entries) { const index = cookies.findIndex((item) => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry; } },
    } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    const root = await client.from("blueprints").select("id").single();
    expect(root.error).toBeNull();
    const nodeId = randomUUID(), proposalId = randomUUID();
    const snapshot = { schemaVersion: 2, id: root.data!.id, version: 0, title: "成果体验测试", goals: [{
      id: randomUUID(), title: "提升演讲能力", position: 0, stages: [{ id: randomUUID(), title: "第一周：练习表达", position: 0,
        nodes: [{ id: nodeId, type: "practice", title: "录制一次三分钟演讲", estimatedMinutes: null, completionCriteria: "", position: 0, dependencyIds: [], resources: [] }],
      }],
    }] };
    expect((await client.from("blueprint_proposals").insert({ id: proposalId, owner_id: id, blueprint_id: root.data!.id,
      base_version: 0, proposed_snapshot: snapshot, client_mutation_id: randomUUID() })).error).toBeNull();
    expect((await client.rpc("apply_blueprint_proposal", { proposal_id: proposalId, expected_version: 0, mutation_id: randomUUID() })).error).toBeNull();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "成长档案", exact: true })).toBeVisible();
    await page.getByLabel("关联路径节点", { exact: true }).selectOption(nodeId);
    await page.getByLabel("这次的收获", { exact: true }).fill("完成首次演讲录制，下一次减少口头禅。");
    await page.getByLabel("作品链接", { exact: true }).fill("https://example.test/my-talk");
    await page.getByRole("button", { name: "保存私人记录", exact: true }).click();
    await expect(page.getByText("记录已保存，仅自己可见。", { exact: false })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(1);
    expect((await client.from("progress_evidence").select("id")).data).toHaveLength(1);
    await page.reload();
    await expect(page.locator("article")).toHaveCount(1);
    await page.getByLabel("这次的收获", { exact: true }).fill("离线草稿：下一次留意停顿。");
    await context.setOffline(true);
    await page.getByRole("button", { name: "保存私人记录", exact: true }).click();
    await expect(page.getByText("尚不能确认是否保存。", { exact: false })).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByLabel("这次的收获", { exact: true })).toHaveValue("离线草稿：下一次留意停顿。");
    await page.getByRole("button", { name: "确认原提交结果", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
    await page.getByLabel("这次的收获", { exact: true }).fill("主题切换不重置这段文字。");
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await expect(page.getByLabel("这次的收获", { exact: true })).toHaveValue("主题切换不重置这段文字。");
      await expect(page.getByText("记录已保存，仅自己可见。", { exact: false })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    expect(errors).toEqual([]);
    const second = await context.newPage();
    await second.goto("/progress");
    await expect(second.getByText("另一标签页正在编辑", { exact: false })).toBeVisible();
    await expect(second.getByLabel("这次的收获", { exact: true })).toHaveJSProperty("readOnly", true);
    await page.close();
    await second.getByRole("button", { name: "重新尝试编辑", exact: true }).click();
    await expect(second.getByLabel("这次的收获", { exact: true })).toHaveJSProperty("readOnly", false);
    await expect(second.getByLabel("这次的收获", { exact: true })).toHaveValue("主题切换不重置这段文字。");
    expect((await client.from("progress_evidence").select("id")).data).toHaveLength(2);
  } finally {
    await context.setOffline(false);
    await context.clearCookies();
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    console.log("Removed only this test's local account and cascaded records; no email was sent.");
  }
});
