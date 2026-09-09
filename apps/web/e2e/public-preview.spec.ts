import { test, expect } from "@playwright/test";

test("visitors can explore the public example without contacting personal services or creating storage", async ({ page, context }, testInfo) => {
  const sideEffects: string[] = [], errors: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" || /\/api\/|supabase|deepseek|supadata/i.test(request.url())) sideEffects.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/preview$/);
  await expect(page.getByText("准备清晰的五分钟公开表达", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开完整示例路径", exact: true }).click();
  await expect(page.getByRole("button", { name: "收起示例路径", exact: true })).toHaveAttribute("aria-expanded", "true");
  for (const theme of ["cyberpunk", "eastern"]) {
    await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
    await expect(page.getByRole("button", { name: "收起示例路径", exact: true })).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${theme}-preview.png`), fullPage: true });
  }
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await context.cookies()).toEqual([]);
  expect(sideEffects).toEqual([]);
  expect(errors).toEqual([]);
  await page.getByRole("link", { name: "建立我的目标", exact: true }).first().click();
  const login = new URL(page.url());
  expect(login.pathname).toBe("/login"); expect(login.searchParams.get("next")).toBe("/goals/new");
  await expect(page.getByRole("heading", { name: "进入你的蓝图", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送登录链接", exact: true })).toBeEnabled();
  expect(sideEffects).toEqual([]);
});

test("public example stays readable with reduced motion and can be skipped using the keyboard", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto("/preview");
  const skip = page.getByRole("link", { name: "跳过示例，登录", exact: true });
  await skip.focus(); await expect(skip).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "先看看公开示例", exact: true }).click();
  await expect(page).toHaveURL(/\/preview$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
