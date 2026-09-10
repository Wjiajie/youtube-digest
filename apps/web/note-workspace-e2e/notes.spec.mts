import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("real account saves and recovers source-bound notes through the production page, with two themes and independent editors", async ({ page, context }, info) => {
  const local = localSupabaseTestConfig(), auth = { persistSession: false, autoRefreshToken: false };
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth });
  const id = randomUUID(), email = `${id}@note-workspace.example.test`, password = randomUUID();
  expect((await admin.auth.admin.createUser({ id, email, password, email_confirm: true })).error).toBeNull();
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, { cookies: {
    getAll: () => cookies, setAll: entries => { for (const entry of entries) { const index = cookies.findIndex(item => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry; } },
  } });
  try {
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    const root = await client.from("blueprints").select("id").single(); expect(root.error).toBeNull();
    const nodeId = randomUUID(), binding = randomUUID(), proposal = randomUUID();
    const snapshot = { schemaVersion: 2, id: root.data!.id, version: 0, title: "笔记体验路径", goals: [{ id: randomUUID(), title: "用影像讲故事", position: 0,
      stages: [{ id: randomUUID(), title: "观察光线", position: 0, nodes: [{ id: nodeId, type: "learn", title: "对比曝光组合", position: 0,
        estimatedMinutes: 30, completionCriteria: "解释画面差异", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] };
    expect((await client.from("blueprint_proposals").insert({ id: proposal, owner_id: id, blueprint_id: root.data!.id,
      base_version: 0, proposed_snapshot: snapshot, client_mutation_id: randomUUID() })).error).toBeNull();
    expect((await client.rpc("apply_blueprint_proposal", { proposal_id: proposal, expected_version: 0, mutation_id: randomUUID() })).error).toBeNull();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3194", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/progress"); await page.getByRole("link", { name: "视频笔记", exact: true }).click();
    await expect(page.getByRole("heading", { name: "视频笔记", exact: true })).toBeVisible();
    await page.getByLabel("笔记关联视频", { exact: true }).selectOption(binding);
    const text = "  光线改变了画面的情绪。\n下一次试着比较背光。  ";
    await page.getByLabel("笔记原文", { exact: true }).fill(text);
    await page.getByLabel("视频位置（秒，可选）", { exact: true }).fill("125");
    await page.getByRole("button", { name: "保存笔记", exact: true }).click();
    await expect(page.getByText("笔记已保存", { exact: true })).toBeVisible();
    const first = await client.rpc("read_learning_note_workspace", { p_owner_id: id }); expect(first.error).toBeNull();
    expect(first.data.records).toHaveLength(1); expect(first.data.records[0]).toMatchObject({ note_text: text, position_seconds: 125, resource_binding_id: binding });
    expect(first.data.blueprint.version).toBe(1);
    await page.getByLabel("笔记关联视频", { exact: true }).selectOption(binding);
    await page.getByLabel("笔记原文", { exact: true }).fill("离线原文，不应被重复保存。");
    await context.setOffline(true); await page.getByRole("button", { name: "保存笔记", exact: true }).click();
    await expect(page.getByText("尚未确认保存结果", { exact: false })).toBeVisible();
    await context.setOffline(false); await page.reload();
    await expect(page.getByLabel("笔记原文", { exact: true })).toHaveValue("离线原文，不应被重复保存。");
    await page.getByRole("button", { name: "确认原笔记提交", exact: true }).click();
    await expect(page.getByText("笔记已保存", { exact: true })).toBeVisible();
    await expect(page.locator(".note-history .bp-panel")).toHaveCount(2);
    await page.getByLabel("笔记原文", { exact: true }).fill(`主题切换保留的草稿。\nhttps://example.test/${"unbrokentext".repeat(15)}`);
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await expect(page.getByLabel("笔记原文", { exact: true })).toHaveValue(/主题切换保留的草稿/);
      await page.screenshot({ path: info.outputPath(`${theme}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByLabel("笔记原文", { exact: true }).focus(); await expect(page.getByLabel("笔记原文", { exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath(`${theme}-320.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const second = await context.newPage(); await second.goto("/progress/notes");
    await expect(second.getByText("另一标签页正在编辑", { exact: false })).toBeVisible();
    await expect(second.getByLabel("笔记原文", { exact: true })).toBeDisabled(); await page.close();
    await second.getByRole("button", { name: "重新尝试编辑笔记", exact: true }).click();
    await expect(second.getByLabel("笔记原文", { exact: true })).toBeEnabled();
    await expect(second.getByLabel("笔记原文", { exact: true })).toHaveValue(/主题切换保留的草稿/);
    expect((await client.rpc("read_learning_note_workspace", { p_owner_id: id })).data.records).toHaveLength(2);
    expect(errors).toEqual([]);
    await context.clearCookies(); await second.reload(); await expect(second).toHaveURL(/\/login\?/);
    await expect(second.getByLabel("笔记原文", { exact: true })).toHaveCount(0);
  } finally { await context.setOffline(false); await context.clearCookies(); await client.auth.signOut(); expect((await admin.auth.admin.deleteUser(id)).error).toBeNull(); }
});
