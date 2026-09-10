import { expect, test } from "@playwright/test";

test("private clarification routes preserve the exact login destination without exposing a workspace", async ({ page }) => {
  const id = "10000000-0000-4000-8000-000000000002", turn = "10000000-0000-4000-8000-000000000003";
  for (const path of ["/goals/new/clarify", `/goals/${id}/clarify?new=1`, `/clarification/${id}?turn=${turn}`]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(path);
    await expect(page.getByLabel("你的回答", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "开启澄清工作台", exact: true })).toHaveCount(0);
  }
});
test("clarification generation refuses anonymous Cookie requests without caching responses", async ({ request }) => {
  const response = await request.post("/api/clarification/turns", { headers: { origin: "http://127.0.0.1:3000" }, data: {} });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.json()).toEqual({ ok: false, code: "unauthenticated" });
});
