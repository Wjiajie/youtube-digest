import { test, expect } from "@playwright/test";

test("resource execution rejects cross-origin and bearer requests without exposing stored evidence", async ({ request, baseURL }) => {
  for (const headers of [{ origin: "https://outside.example" }, { origin: baseURL!, authorization: "Bearer caller-token" }]) {
    const response = await request.post("/api/resources/runs", { headers, data: {} });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "forbidden" });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});
test("resource execution requires a current Cookie identity and never performs work on GET", async ({ request, baseURL }) => {
  const response = await request.post("/api/resources/runs", { headers: { origin: baseURL! }, data: {} });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ ok: false, code: "unauthenticated" });
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await request.get("/api/resources/runs")).status()).toBe(405);
});
