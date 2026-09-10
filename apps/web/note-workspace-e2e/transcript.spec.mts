import { test, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { transcriptFixture } from "../transcript-e2e/fixture";

test("real account reads original captions from its path across two themes and loses body after clearing", async ({ page, context }, info) => {
  const fixture = await transcriptFixture(), cookies: { name: string; value: string }[] = [];
  const client = createServerClient(fixture.local.API_URL, fixture.local.PUBLISHABLE_KEY, { cookies: {
    getAll: () => cookies, setAll: entries => { for (const entry of entries) { const index = cookies.findIndex(item => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry; } },
  } });
  try {
    expect((await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password })).error).toBeNull();
    const source = await fixture.acquire();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://127.0.0.1:3194", sameSite: "Lax" as const })));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/paths/${fixture.goalId}`); await page.getByRole("link", { name: "阅读视频 1 的原始字幕", exact: true }).click();
    await expect(page.getByRole("heading", { name: "原始字幕", exact: true })).toBeVisible();
    await expect(page.locator(".transcript-segments")).toHaveCount(0);
    await page.getByRole("button", { name: "读取原始字幕", exact: true }).press("Enter");
    await expect(page.locator(".transcript-segments li")).toHaveCount(20);
    await expect(page.getByRole("link", { name: "在 YouTube 打开 0:15", exact: true })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=15s");
    await page.screenshot({ path: info.outputPath("cyber-transcript-desktop.png") });
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page.getByText("最后一段：用自己的照片解释你的选择。", { exact: true })).toBeVisible();
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题" }).selectOption(theme);
      await expect(page.getByText("第 21–21 段 / 共 21 段", { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 320, height: 1100 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("button", { name: "上一页", exact: true }).focus(); await expect(page.getByRole("button", { name: "上一页", exact: true })).toBeFocused();
      await page.screenshot({ path: info.outputPath(`${theme}-transcript-320.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.screenshot({ path: info.outputPath("eastern-transcript-desktop.png") });
    expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes("Observe the light") || value.includes("最后一段")))).toBe(false);
    const response = await page.request.get(`/api/v1/learning-transcript?bindingId=${fixture.bindingId}&videoId=${fixture.videoId}&sourceRunId=${source}&offset=20`);
    expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store"); expect((await response.json()).segments).toHaveLength(1);
    for (const query of ["&offset=20&offset=0", "&offset=20", "&private=body", "&offset=1", "&offset=00"]) {
      const invalid = await page.request.get(`/api/v1/learning-transcript?bindingId=${fixture.bindingId}&videoId=${fixture.videoId}${query}`);
      expect(invalid.status()).toBe(422); expect(await invalid.json()).toEqual({ code: "invalid" });
    }
    expect((await fixture.client.rpc("clear_resource_evidence", { p_run_id: source })).error).toBeNull();
    await page.getByRole("button", { name: "重新读取字幕", exact: true }).click();
    await expect(page.getByText("这份字幕材料已清除。", { exact: true })).toBeVisible(); await expect(page.locator(".transcript-segments")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("eastern-transcript-cleared.png"), fullPage: true });
    expect(errors).toEqual([]);
    await context.clearCookies();
    const anonymous = await page.request.get(`/api/v1/learning-transcript?bindingId=${fixture.bindingId}&videoId=${fixture.videoId}`);
    expect(anonymous.status()).toBe(401); await page.reload(); await expect(page).toHaveURL(/\/login\?/);
  } finally { await context.clearCookies(); await client.auth.signOut(); await fixture.cleanup(); }
});
