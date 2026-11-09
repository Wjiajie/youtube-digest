import { expect, test } from "@playwright/test";

test("loaded VRM advertises its controls and receives a simulated conversation response", async ({ page }) => {
  let requested: any;
  await page.route("**/api/companion", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation !== "text") return route.continue();
    requested = body;
    const control = body.capabilities?.controls.find((c: any) => c.kind === "expression");
    const cue = control && { revision: body.capabilities.revision, kind: control.kind, id: control.id, value: 0.7, duration: 2 };
    await route.fulfill({ contentType: "text/event-stream", body:
      (cue ? `data: ${JSON.stringify({ type: "cue", cue })}\n\n` : "") +
      `data: ${JSON.stringify({ type: "delta", text: "模拟回复" })}\n\n` +
      `data: ${JSON.stringify({ type: "done", messages: [], actions: [] })}\n\n` });
  });
  await page.goto("/");
  await expect(page.locator("[data-avatar-ready='true']")).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".companion-view-controls")).toHaveCount(0);
  await page.getByRole("textbox", { name: "和 Shayna 对话" }).fill("你好");
  await page.getByRole("button", { name: "发送文字" }).click();
  await expect.poll(() => requested?.capabilities?.controls?.length ?? 0).toBeGreaterThan(0);
  expect(requested.capabilities.revision).toMatch(/^[0-9a-f-]{36}$/);
  expect(requested.capabilities.controls.some((c: any) => c.kind === "expression")).toBe(true);
  await expect(page.getByText("模拟回复")).toBeVisible();
});
