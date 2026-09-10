import { expect, test } from "@playwright/test";
test("private planning pages retain login destinations without revealing a run", async ({ page }) => {
  const id = "10000000-0000-4000-8000-000000000002";
  for (const path of [`/planning/${id}`, `/goals/${id}/planning`]) {
    await page.goto(path); await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole("button", { name: "取消本次规划" })).toHaveCount(0);
  }
});
