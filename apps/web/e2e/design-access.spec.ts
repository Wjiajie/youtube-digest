import { expect, test } from "@playwright/test";

test("internal theme specimens are not exposed by the production build", async ({ page }) => {
  const response = await page.goto("/design");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("BLUEPRINT / DESIGN LAB · 01")).toHaveCount(0);
});
