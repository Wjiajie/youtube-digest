import { test, expect } from "@playwright/test";

test("anonymous visitors cannot open private resume positions and retain their destination", async ({ page }) => {
  await page.goto("/progress/resume"); await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/progress/resume");
  await expect(page.getByRole("heading", { name: "继续学习", exact: true })).toHaveCount(0);
});
