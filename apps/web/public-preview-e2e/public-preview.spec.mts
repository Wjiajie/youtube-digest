import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("a real local account leaves the public example for its own empty goal definition without importing fiction", async ({ page, context }, testInfo) => {
  const local = localSupabaseTestConfig();
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = randomUUID(), email = `${id}@preview.example.test`, password = randomUUID();
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
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page).toHaveURL(/\/preview$/);
    await page.getByRole("button", { name: "展开完整示例路径", exact: true }).click();
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-narrow.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole("link", { name: "建立我的目标", exact: true }).first().click();
    await expect(page).toHaveURL(/\/login\?next=%2Fgoals%2Fnew$/);
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    for (let attempt = 0; attempt < 6; attempt++) {
      const probe = await client.rpc("read_node_status_workspace", { p_owner_id: id });
      if (!probe.error) break;
      if (probe.error.code !== "PGRST303" || probe.error.message !== "JWT issued at future" || attempt === 5) throw new Error(`Local readiness failed: ${probe.error.code}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    // Use only real local Auth-issued cookies. This does not test email delivery.
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
    await page.reload();
    await expect(page).toHaveURL(/\/goals\/[0-9a-f-]+\?draft=1$/);
    await expect(page.getByRole("heading", { name: "让目标有据可循", exact: true })).toBeVisible();
    await expect(page.getByLabel("我希望实现", { exact: true })).toHaveValue("");
    await page.goto("/");
    await expect(page).toHaveURL("http://127.0.0.1:3100/");
    await expect(page.getByRole("heading", { name: "我的蓝图", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "还没有正式目标", exact: true })).toBeVisible();
    await expect(page.getByText("准备清晰的五分钟公开表达", { exact: true })).toHaveCount(0);
    const workspace = await client.rpc("read_node_status_workspace", { p_owner_id: id });
    expect(workspace.error).toBeNull();
    expect(workspace.data.blueprint.goals).toEqual([]); expect(workspace.data.blueprint.version).toBe(0);
    expect(workspace.data.current).toEqual([]); expect(workspace.data.history).toEqual([]);
    const evidence = await client.from("progress_evidence").select("id");
    expect(evidence.error).toBeNull(); expect(evidence.data).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([context.clearCookies(), client.auth.signOut()]);
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    console.info("Removed only this run's local preview account and cascaded fixtures; no email sent.");
  }
});
