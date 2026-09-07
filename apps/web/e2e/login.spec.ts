import { expect, test } from "@playwright/test";

test("invited email flow remains recoverable without horizontal overflow", async ({ page }) => {
  await page.route("**/api/auth/request-otp", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  }));
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "进入你的蓝图" })).toBeVisible();
  await page.getByLabel("邮箱").fill("invited@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("button", { name: "请求已提交" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("请求已提交");
  await expect(page.getByRole("status")).not.toContainText("已经发送");

  await page.getByRole("button", { name: "更换邮箱" }).click();
  await expect(page.getByLabel("邮箱")).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("email rate limits preserve the address and do not automatically resend", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/auth/request-otp", (route) => {
    requests++;
    return route.fulfill({ status: 429, contentType: "application/json", body: '{"ok":false,"code":"rate_limited"}' });
  });
  await page.goto("/login");
  await page.clock.install();
  await page.getByLabel("邮箱").fill("invited@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("邮件服务暂时限流");
  await expect(page.getByLabel("邮箱")).toHaveValue("invited@example.com");
  await expect(page.getByRole("button", { name: /秒后可手动重试/ })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "发送登录链接" })).toBeEnabled();
  expect(requests).toBe(1);
});

test("expired login links explain how to recover", async ({ page }) => {
  await page.goto("/login?error=invalid_link&next=%2Foauth%2Fconsent%3Fauthorization_id%3Dexample");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("登录链接已失效或无法验证");
  await expect(page.getByLabel("邮箱")).toBeEnabled();
});

test("a temporary service failure keeps the form recoverable", async ({ page }) => {
  await page.route("**/api/auth/request-otp", (route) => route.fulfill({ status: 503 }));
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("invited@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("登录邮件服务暂不可用");
  await expect(page.getByLabel("邮箱")).toHaveValue("invited@example.com");
  await expect(page.getByRole("button", { name: "发送登录链接" })).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("a network interruption never claims delivery", async ({ page }) => {
  await page.route("**/api/auth/request-otp", (route) => route.abort("failed"));
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("invited@example.com");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("无法确认请求是否送达");
  await expect(page.getByLabel("邮箱")).toHaveValue("invited@example.com");
  await expect(page.getByRole("status")).toHaveCount(0);
});
