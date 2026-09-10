import { expect, test } from "@playwright/test";

for (const path of ["/design", "/design/assets", "/design/environment"]) test(`internal specimen ${path} is not exposed by the production build`, async ({ page }) => {
  const response = await page.goto(path);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("BLUEPRINT / DESIGN LAB · 01")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "人物资产 · 实时试装" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "让目标世界有自己的风景" })).toHaveCount(0);
});
