import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("real user reviews node effort and completion criteria before they become official", async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(10_000);
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), email = `${id}@node-planning.example.test`, password = randomUUID();
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
    async function read() {
      const result = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
      expect(result.error).toBeNull();
      return result.data;
    }
    // Read readiness only; never retry a mutation or alter Auth-issued claims.
    for (let attempt = 0; attempt < 6; attempt++) {
      const probe = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
      if (!probe.error) { expect(probe.data.version).toBe(0); break; }
      if (probe.error.code !== "PGRST303" || probe.error.message !== "JWT issued at future" || attempt === 5) throw new Error(`Local readiness failed: ${probe.error.code}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "添加目标", exact: true }).click();
    await page.getByLabel("目标", { exact: true }).fill("准备一次公开演讲");
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    await page.getByRole("combobox", { name: "类型", exact: true }).selectOption("practice");
    await page.getByLabel("节点", { exact: true }).fill("录制并回看一次三分钟演讲");
    await page.getByLabel("预计投入（分钟）", { exact: true }).fill("90");
    await page.getByLabel("完成依据", { exact: true }).fill("保存一段录制，指出三个可以改善的地方。");
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await expect(page.getByLabel("完成依据", { exact: true })).toHaveValue("保存一段录制，指出三个可以改善的地方。");
      await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.reload();
    await expect(page.getByLabel("预计投入（分钟）", { exact: true })).toHaveValue("90");
    await page.getByRole("button", { name: "查看修改", exact: true }).click();
    const review = page.locator(".proposal");
    await expect(review).toContainText("90 分钟");
    await expect(review).toContainText("保存一段录制，指出三个可以改善的地方。");
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await review.screenshot({ path: testInfo.outputPath(`${theme}-review-desktop.png`) });
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await review.screenshot({ path: testInfo.outputPath(`${theme}-review-narrow.png`) });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    expect((await read()).goals).toEqual([]);
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByText("一份属于你的目标蓝图 · 版本 1", { exact: true })).toBeVisible();
    const confirmed = await read();
    expect(confirmed.schemaVersion).toBe(2);
    expect(confirmed.goals[0].stages[0].nodes[0]).toMatchObject({ estimatedMinutes: 90, completionCriteria: "保存一段录制，指出三个可以改善的地方。", resources: [] });
    await page.getByLabel("预计投入（分钟）", { exact: true }).fill("60");
    await page.getByRole("button", { name: "查看修改", exact: true }).click();
    await expect(review).toContainText("90 分钟");
    await expect(review).toContainText("60 分钟");
    expect((await read()).version).toBe(1);
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByText("一份属于你的目标蓝图 · 版本 2", { exact: true })).toBeVisible();
    await page.getByLabel("预计投入（分钟）", { exact: true }).fill("");
    await page.getByLabel("完成依据", { exact: true }).fill("");
    await page.getByRole("button", { name: "查看修改", exact: true }).click();
    await expect(review).toContainText("待明确");
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByText("一份属于你的目标蓝图 · 版本 3", { exact: true })).toBeVisible();
    const cleared = await read();
    expect(cleared.goals[0].stages[0].nodes[0]).toMatchObject({ estimatedMinutes: null, completionCriteria: "" });
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([context.setOffline(false), context.clearCookies(), client.auth.signOut()]);
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    console.log("Removed only this run's local account and cascaded node planning records; no email sent.");
  }
});
