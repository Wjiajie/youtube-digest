import { test, expect } from "@playwright/test";

test("private Goal Brief pages preserve their login return path without exposing a definition", async ({ page }) => {
  for (const path of ["/goals", "/goals/new", "/goals/c6000000-0000-4000-8000-000000000010?draft=1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(path);
    await expect(page.getByRole("heading", { name: "目标定义卡", exact: true })).toHaveCount(0);
  }
});
