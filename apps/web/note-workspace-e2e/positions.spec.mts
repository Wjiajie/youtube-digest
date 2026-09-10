import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

test("real account explicitly reconciles another device, recovers offline position and retains its draft across both themes", async ({ page, context }, info) => {
  const local = localSupabaseTestConfig(), auth = { persistSession: false, autoRefreshToken: false };
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth });
  const id = randomUUID(), email = `${id}@position-workspace.example.test`, password = randomUUID();
  expect((await admin.auth.admin.createUser({ id, email, password, email_confirm: true })).error).toBeNull();
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, { cookies: {
    getAll: () => cookies, setAll: entries => { for (const entry of entries) { const index = cookies.findIndex(item => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry; } },
  } });
  try {
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    const root = await client.from("blueprints").select("id").single(); expect(root.error).toBeNull();
    const nodeId = randomUUID(), binding = randomUUID(), proposal = randomUUID();
    const snapshot = { schemaVersion: 2, id: root.data!.id, version: 0, title: "继续学习体验路径", goals: [{ id: randomUUID(), title: "用影像讲故事", position: 0,
      stages: [{ id: randomUUID(), title: "观察光线", position: 0, nodes: [{ id: nodeId, type: "learn", title: "对比曝光组合", position: 0,
        estimatedMinutes: 30, completionCriteria: "解释画面差异", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] };
    expect((await client.from("blueprint_proposals").insert({ id: proposal, owner_id: id, blueprint_id: root.data!.id,
      base_version: 0, proposed_snapshot: snapshot, client_mutation_id: randomUUID() })).error).toBeNull();
    expect((await client.rpc("apply_blueprint_proposal", { proposal_id: proposal, expected_version: 0, mutation_id: randomUUID() })).error).toBeNull();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3194", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/progress"); await page.getByRole("link", { name: "继续学习", exact: true }).click();
    await expect(page.getByRole("heading", { name: "继续学习", exact: true })).toBeVisible();
    const position = page.getByLabel("继续学习位置（秒）", { exact: true });
    async function confirm() {
      await page.getByLabel("继续学习关联视频", { exact: true }).selectOption(binding);
      await page.getByRole("button", { name: "读取所选视频位置", exact: true }).click();
      await page.getByRole("button", { name: "使用此来源与最新位置版本", exact: true }).click();
    }
    await confirm(); await position.fill("125"); await page.getByRole("button", { name: "保存继续学习位置", exact: true }).press("Enter");
    await expect(page.getByText("位置已保存", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "打开原视频 · 125 秒" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=125s");
    const first = await client.rpc("read_learning_position_workspace", { p_owner_id: id }); expect(first.error).toBeNull();
    expect(first.data.records).toHaveLength(1); expect(first.data.records[0]).toMatchObject({ position_seconds: 125, resource_binding_id: binding, position_version: 1 });
    expect(first.data.blueprint.version).toBe(1);
    await confirm(); await position.fill("42");
    const other = await client.rpc("record_learning_position", { p_node_id: nodeId, p_resource_binding_id: binding, p_expected_version: 1,
      p_expected_position_version: 1, p_position_seconds: 200, p_client_mutation_id: randomUUID() });
    expect(other.error).toBeNull();
    await page.getByRole("button", { name: "保存继续学习位置", exact: true }).click();
    await expect(page.getByText("本次保存已被拒绝", { exact: false })).toBeVisible(); await expect(position).toHaveValue("42");
    await page.getByRole("button", { name: "读取所选视频位置", exact: true }).click();
    await expect(page.getByText("云端保存：200 秒", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存继续学习位置", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "使用此来源与最新位置版本", exact: true }).click(); await expect(position).toHaveValue("42");
    await page.getByRole("button", { name: "保存继续学习位置", exact: true }).click(); await expect(page.getByText("位置已保存", { exact: true })).toBeVisible();
    await confirm(); await position.fill("88");
    await context.setOffline(true); await page.getByRole("button", { name: "保存继续学习位置", exact: true }).click();
    await expect(page.getByText("尚未确认保存结果", { exact: false })).toBeVisible();
    await context.setOffline(false); await page.reload(); await expect(position).toHaveValue("88");
    await expect(position).toBeDisabled();
    const beforeRetry = await client.rpc("read_learning_position_workspace", { p_owner_id: id }); expect(beforeRetry.data.records[0].position_seconds).toBe(42);
    await page.getByRole("button", { name: "确认原位置提交", exact: true }).click(); await expect(page.getByText("位置已保存", { exact: true })).toBeVisible();
    const recovered = await client.rpc("read_learning_position_workspace", { p_owner_id: id }); expect(recovered.error).toBeNull();
    expect(recovered.data.records[0]).toMatchObject({ position_seconds: 88, position_version: 4 }); expect(recovered.data.blueprint.version).toBe(1);
    await confirm(); await position.fill("90");
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme); await expect(position).toHaveValue("90");
      await page.screenshot({ path: info.outputPath(`${theme}-positions-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await position.focus(); await expect(position).toBeFocused(); await page.screenshot({ path: info.outputPath(`${theme}-positions-320.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const second = await context.newPage(); await second.goto("/progress/resume");
    await expect(second.getByText("另一标签页正在编辑", { exact: false })).toBeVisible(); await expect(second.getByLabel("继续学习位置（秒）", { exact: true })).toBeDisabled();
    await page.close(); await second.getByRole("button", { name: "重新尝试编辑位置", exact: true }).click();
    await expect(second.getByLabel("继续学习位置（秒）", { exact: true })).toHaveValue("90");
    await expect(second.getByRole("button", { name: "保存继续学习位置", exact: true })).toBeDisabled();
    await second.getByRole("button", { name: "读取所选视频位置", exact: true }).click(); await second.getByRole("button", { name: "使用此来源与最新位置版本", exact: true }).click();
    await expect(second.getByRole("button", { name: "保存继续学习位置", exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
    await context.clearCookies(); await second.reload(); await expect(second).toHaveURL(/\/login\?/); await expect(second.getByLabel("继续学习位置（秒）", { exact: true })).toHaveCount(0);
  } finally { await context.setOffline(false); await context.clearCookies(); await client.auth.signOut(); expect((await admin.auth.admin.deleteUser(id)).error).toBeNull(); }
});
