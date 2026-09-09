import { test, expect } from "@playwright/test";

test("private journal asks for login while retaining the return path", async ({ page }) => {
  await page.goto("/progress");
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/progress");
  await expect(page.getByRole("heading", { name: "成长档案", exact: true })).toHaveCount(0);
});

test("production journal endpoints reject anonymous reads and writes without caching", async ({ request }) => {
  for (const response of [await request.get("/api/v1/progress-evidence"), await request.post("/api/v1/progress-evidence", { data: {} })]) {
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "unauthenticated" });
  }
});
