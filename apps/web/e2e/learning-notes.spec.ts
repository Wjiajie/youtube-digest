import { test, expect } from "@playwright/test";

test("anonymous visitors cannot open the private note workspace", async ({ page }) => {
  await page.goto("/progress/notes");
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/progress/notes");
  await expect(page.getByRole("heading", { name: "视频笔记", exact: true })).toHaveCount(0);
});
