import { test, expect } from "@playwright/test";

test("formal home, paths and editor never show private content before login", async ({ page }) => {
  for (const path of ["/paths", "/blueprint/edit", "/paths/a6000000-0000-4000-8000-000000000010?node=a6000000-0000-4000-8000-000000000030"]) {
    await page.goto(path);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next") ?? "/").toBe(path);
    await expect(page.getByRole("heading", { name: "我的蓝图", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "添加目标", exact: true })).toHaveCount(0);
  }
});
