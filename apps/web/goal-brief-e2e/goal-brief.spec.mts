import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("real local user defines, confirms, resumes and reviews a goal in both themes", async ({ page, context }, testInfo) => {
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), email = `${id}@goal-brief.example.test`, password = randomUUID();
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
    // Same narrow, readonly readiness boundary as the local RPC suite; never retry a write.
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await client.from("blueprints").select("version").single();
      if (!result.error) { expect(result.data.version).toBe(0); break; }
      if (result.error.code !== "PGRST303" || result.error.message !== "JWT issued at future" || attempt === 5) throw new Error(`Local database readiness failed: ${result.error.code}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/goals");
    await expect(page.getByRole("heading", { name: "我的目标定义", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "直接填写目标定义", exact: true }).click();
    await expect(page.getByRole("heading", { name: "目标定义卡", exact: true })).toBeVisible();
    const url = page.url();
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
    await page.getByLabel("我希望实现", { exact: true }).fill("完成一场公开演讲");
    await expect(page.getByRole("button", { name: "确认这版目标定义", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByText("已保存到云端，仅自己可见。尚未生成路径。", { exact: true })).toBeVisible();
    await page.getByLabel("我的起点", { exact: true }).fill("有课堂演讲经验，希望更自然地表达。");
    await page.getByLabel("每周可投入分钟", { exact: true }).fill("180");
    await page.getByLabel("成功的依据", { exact: true }).fill("录制一场十分钟演讲，并收集三位听众的反馈。");
    await page.getByRole("button", { name: "确认这版目标定义", exact: true }).click();
    await expect(page.getByText("当前云端定义已确认", { exact: true })).toBeVisible();
    const stored = await client.from("goal_briefs").select("id,revision,status").single();
    expect(stored.error).toBeNull(); expect(stored.data?.status).toBe("confirmed"); expect(stored.data?.revision).toBe(2);
    expect((await client.from("blueprints").select("version").single()).data?.version).toBe(0);
    await page.getByLabel("约束", { exact: true }).fill("每周只能在周末练习。");
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await expect(page.getByLabel("约束", { exact: true })).toHaveValue("每周只能在周末练习。");
      await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await context.setOffline(true);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByRole("button", { name: "核对原提交结果", exact: true })).toBeEnabled();
    await context.setOffline(false); await page.reload();
    await expect(page.getByLabel("约束", { exact: true })).toHaveValue("每周只能在周末练习。");
    await page.getByRole("button", { name: "核对原提交结果", exact: true }).click();
    await expect(page.getByText("已保存到云端，仅自己可见。尚未生成路径。", { exact: true })).toBeVisible();
    expect((await client.from("goal_briefs").select("revision,status").single()).data).toEqual({ revision: 3, status: "draft" });
    await page.getByLabel("我希望实现", { exact: true }).fill("继续完善我的公开演讲目标");
    const second = await context.newPage(); await second.goto(url);
    await expect(second.getByText("另一标签页正在编辑此定义", { exact: false })).toBeVisible();
    await expect(second.getByLabel("我希望实现", { exact: true })).toHaveJSProperty("readOnly", true);
    await page.close(); await second.getByRole("button", { name: "接手编辑", exact: true }).click();
    await expect(second.getByLabel("我希望实现", { exact: true })).toHaveJSProperty("readOnly", false);
    await expect(second.getByLabel("我希望实现", { exact: true })).toHaveValue("继续完善我的公开演讲目标");
    await second.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(second.getByText("已保存到云端，仅自己可见。尚未生成路径。", { exact: true })).toBeVisible();
    await second.goto("/goals");
    await expect(second.getByRole("heading", { name: "继续完善我的公开演讲目标", exact: true })).toBeVisible();
    await second.screenshot({ path: testInfo.outputPath("eastern-list.png"), fullPage: true });
    await second.goto(`/goals/${randomUUID()}`);
    await expect(second.getByText("没有找到可访问的目标定义", { exact: false })).toBeVisible();
    await expect(second.getByRole("button", { name: "保存草稿", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.setOffline(false); await context.clearCookies();
    await client.auth.signOut().catch(() => {});
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    console.log("Removed only this run's local account and cascaded definitions; no email sent.");
  }
});
