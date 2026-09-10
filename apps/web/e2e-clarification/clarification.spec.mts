import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { localSupabaseTestConfig } from "../../../scripts/local-supabase-test-config.mjs";

for (const theme of ["cyberpunk", "eastern"]) {
  test(`real local clarification: empty brief to explicit confirmation in ${theme}`, async ({ page, context }, testInfo) => {
    const local = localSupabaseTestConfig();
    const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const id = randomUUID(), password = randomUUID(), email = `${id}@clarification-production.example.test`;
    const cookies: { name: string; value: string }[] = [];
    const client = createServerClient(local.API_URL, local.PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => cookies,
        setAll: entries => {
          for (const entry of entries) {
            const index = cookies.findIndex(item => item.name === entry.name);
            if (index < 0) cookies.push(entry); else cookies[index] = entry;
          }
        },
      },
    });
    expect((await admin.auth.admin.createUser({ id, email, password, email_confirm: true })).error).toBeNull();
    try {
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
      await expect.poll(async () => (await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id })).error?.code ?? null).toBeNull();
      const before = await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id });
      expect(before.error).toBeNull();
      await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3100", sameSite: "Lax" as const })));
      const errors: string[] = [], browserBodies: Promise<string>[] = [], leakedHeaders: boolean[] = [], unsafeRequests: string[] = [];
      let inferencePosts = 0;
      context.on("request", request => {
        if (new URL(request.url()).hostname === "clarification-unsafe.example.test") unsafeRequests.push(request.url());
        if (request.url().endsWith("/api/clarification/turns") && request.method() === "POST") inferencePosts++;
      });
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (request.headers()["x-blueprint-worker-secret"]) leakedHeaders.push(true); });
      page.on("response", response => {
        const url = new URL(response.url()), type = response.headers()["content-type"] ?? "";
        if (url.origin === "http://127.0.0.1:3100" && /text\/html|text\/x-component|javascript|application\/json/.test(type)) {
          browserBodies.push(response.text().catch(() => ""));
        }
      });
      await page.goto("/goals/new/clarify");
      await expect(page.getByRole("button", { name: "开启澄清工作台", exact: true })).toBeVisible();
      const briefId = new URL(page.url()).pathname.split("/")[2];
      expect((await client.from("goal_briefs").select("id").eq("id", briefId)).data).toEqual([]);
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await expect(page.locator("[data-bp-theme]").first()).toHaveAttribute("data-bp-theme", theme);
      await page.getByRole("button", { name: "保存到账号", exact: true }).click();
      await expect(page.getByText("主题已保存到账号。扩展将在重新读取时跟随。", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "开启澄清工作台", exact: true }).click();
      await expect(page).toHaveURL(/\/clarification\/[0-9a-f-]+$/);
      await expect(page.locator("[data-bp-theme]").first()).toHaveAttribute("data-bp-theme", theme);
      const sessionId = new URL(page.url()).pathname.split("/")[2];
      await expect(page.getByLabel("你的回答", { exact: true })).toBeVisible();
      const empty = await client.from("goal_briefs").select("status,revision,content").eq("id", briefId).single();
      expect(empty.error).toBeNull(); expect(empty.data?.status).toBe("draft"); expect(empty.data?.revision).toBe(1);
      expect(empty.data?.content.outcome).toBe("");
      const command = { accountId: id, sessionId, turnId: randomUUID(), expectedRevision: 1, message: "尚未允许模型执行" };
      const post = (data: object, origin = "http://127.0.0.1:3100") => context.request.post("/api/clarification/turns", { headers: { origin }, data });
      expect((await post(command, "https://outside.example")).status()).toBe(403);
      expect((await post({ ...command, accountId: randomUUID() })).status()).toBe(403);
      expect((await post({ ...command, extra: "not accepted" })).status()).toBe(422);
      expect((await post({ ...command, message: "汉".repeat(22000) })).status()).toBe(413);
      expect((await post(command)).status()).toBe(429);
      expect((await client.from("goal_clarification_turns").select("id")).data).toEqual([]);
      execFileSync("docker", ["exec", "supabase_db_blueprint-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
        `insert into private.goal_clarification_quotas(owner_id,available_attempts) values ('${id}',1);`], { stdio: "pipe" });
      const completed = page.waitForResponse(response => response.url().endsWith("/api/clarification/turns") && response.request().method() === "POST");
      await page.getByLabel("你的回答", { exact: true }).fill("我想制作摄影作品。我会用相机。每周180分钟。成功依据是六张照片与取舍记录。");
      await page.getByRole("button", { name: "发送回答", exact: true }).click();
      await expect(page).toHaveURL(/\?turn=[0-9a-f-]+$/);
      const recoveryUrl = page.url();
      const recovered = await context.newPage();
      await recovered.goto(recoveryUrl);
      await expect(recovered.getByRole("button", { name: "取消本轮", exact: true })).toBeVisible();
      await expect(recovered.locator("[data-bp-theme]").first()).toHaveAttribute("data-bp-theme", theme);
      const response = await completed;
      expect(response.status()).toBe(200);
      const receipt = await response.json();
      expect(receipt).toEqual({ ok: true, turnId: expect.any(String), status: "ready" });
      expect(new URL(recoveryUrl).searchParams.get("turn")).toBe(receipt.turnId);
      await recovered.getByRole("button", { name: "刷新云端记录", exact: true }).click();
      await expect(recovered.getByLabel("我希望实现", { exact: true })).toHaveValue("制作摄影作品");
      await expect(recovered.locator(".clarification-narrative a, .clarification-narrative img")).toHaveCount(0);
      await recovered.close();
      await expect(page.getByLabel("我希望实现", { exact: true })).toHaveValue("制作摄影作品");
      await expect(page.getByLabel("每周可投入分钟", { exact: true })).toHaveValue("180");
      await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "确认这版目标定义", exact: true })).toBeDisabled();
      expect((await client.from("goal_briefs").select("content").eq("id", briefId).single()).data?.content.outcome).toBe("");
      const persisted = await client.rpc("read_goal_clarification_turn", { p_turn_id: receipt.turnId });
      expect(persisted.error).toBeNull(); expect(persisted.data.status).toBe("ready");
      expect(persisted.data.skill.instructions).toContain("# Clarify a Goal Brief");
      expect(persisted.data.result.source.briefRevision).toBe(1);
      await page.getByLabel("我的起点", { exact: true }).fill("会用相机，也能手动调整曝光");
      await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "更新工作摘要", exact: true }).click();
      await expect(page.getByText("工作摘要已更新；目标定义尚未保存。", { exact: true })).toBeVisible();
      await page.locator("summary").filter({ hasText: "查看建议改动与原话依据" }).click();
      await expect(page.locator(".clarification-narrative a, .clarification-narrative img")).toHaveCount(0);
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 });
        await expect(page.locator("[data-bp-theme]").first()).toHaveAttribute("data-bp-theme", theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${theme}-summary-${width}.png`), fullPage: true });
      }
      await page.getByRole("checkbox", { name: "我已核对摘要，确认它表达了我的目标", exact: true }).check();
      await page.getByRole("button", { name: "确认这版目标定义", exact: true }).click();
      await expect(page.getByText("本次保存已完成。当前状态请以目标定义页面为准。", { exact: true })).toBeVisible();
      const saved = await client.from("goal_briefs").select("status,revision,content").eq("id", briefId).single();
      expect(saved.error).toBeNull(); expect(saved.data?.status).toBe("confirmed"); expect(saved.data?.revision).toBe(2);
      expect(saved.data?.content).toEqual({ schemaVersion: 1, outcome: "制作摄影作品", startingPoint: "会用相机，也能手动调整曝光",
        weeklyMinutes: 180, targetDate: null, constraints: "", successCriteria: "六张照片与取舍记录" });
      expect((await client.rpc("read_blueprint_snapshot_v2", { p_owner_id: id })).data).toEqual(before.data);
      const finalSession = await client.rpc("read_goal_clarification", { p_session_id: sessionId });
      expect(finalSession.data.status).toBe("closed"); expect(finalSession.data.revision).toBe(4);
      expect((await client.from("goal_clarification_turns").select("id")).data).toHaveLength(1);
      const browserText = (await Promise.all(browserBodies)).join("\n");
      expect(browserText).not.toContain("local-only-clarification-worker-fixture-secret-32");
      expect(browserText).not.toContain("clarification-fixture-key");
      expect(browserText).not.toContain(persisted.data.skill.sha256);
      expect(browserText).not.toContain("# Clarify a Goal Brief");
      expect(leakedHeaders).toEqual([]);
      expect(unsafeRequests).toEqual([]);
      expect(inferencePosts).toBe(1);
      await expect(page.locator("[data-bp-theme]").first()).toHaveAttribute("data-bp-theme", theme);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-confirmed-320.png`), fullPage: true });
      await page.getByRole("link", { name: "查看目标定义 →", exact: true }).click();
      await expect(page.getByLabel("我的起点", { exact: true })).toHaveValue("会用相机，也能手动调整曝光");
      expect(errors).toEqual([]);
    } finally {
      await context.clearCookies();
      await client.auth.signOut().catch(() => {});
      expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    }
  });
}
