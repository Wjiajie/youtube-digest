import { expect, test } from "@playwright/test";

test("production preferences reject anonymous reads without shared caching", async ({ request }) => {
  const response = await request.get("/api/v1/account-preferences");
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ code: "unauthenticated" });
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});
