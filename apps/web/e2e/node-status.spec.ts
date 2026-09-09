import { test, expect } from "@playwright/test";

test("anonymous visitors cannot open a private node status workspace", async ({ page }) => {
  await page.goto("/progress/status");
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/progress/status");
  await expect(page.getByRole("heading", { name: "节点状态", exact: true })).toHaveCount(0);
});

test("node status reads and writes require identity and never cache private responses", async ({ request }) => {
  for (const response of [await request.get("/api/v1/node-status"), await request.post("/api/v1/node-status", { data: {} })]) {
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "unauthenticated" });
  }
});
