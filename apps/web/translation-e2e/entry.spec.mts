import { test, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { transcriptFixture } from "../transcript-e2e/fixture";

const origin = "http://127.0.0.1:3200", provider = "http://127.0.0.1:3201";
const disabled = process.env.BLUEPRINT_TRANSLATION_ENTRY_TEST_DISABLED === "true";
const accounts: { cleanup(): Promise<void> }[] = [];
async function account() {
  const owner = await transcriptFixture();
  const cleanup = { cleanup: owner.cleanup }; accounts.push(cleanup);
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(owner.local.API_URL, owner.local.PUBLISHABLE_KEY, { cookies: {
    getAll: () => cookies, setAll: entries => { for (const entry of entries) {
      const index = cookies.findIndex(item => item.name === entry.name); if (index < 0) cookies.push(entry); else cookies[index] = entry;
    } },
  } });
  cleanup.cleanup = async () => { try { await client.auth.signOut(); } finally { await owner.cleanup(); } };
  expect((await client.auth.signInWithPassword({ email: owner.email, password: owner.password })).error).toBeNull();
  execFileSync("docker", ["exec", "-i", "supabase_db_blueprint-local", "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `insert into private.translation_run_quotas(owner_id,remaining) values('${owner.ownerId}',2);`, stdio: ["pipe", "pipe", "pipe"],
  });
  return { ...owner, cookies, headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "), origin } };
}
test.beforeEach(async ({ request }) => { expect((await request.post(`${provider}/fixture/reset`)).ok()).toBe(true); });
test.afterEach(async () => { await Promise.all(accounts.splice(0).map(owner => owner.cleanup())); });

test("finds only the signed-in owner's latest exact-page run without generation", async ({ request }) => {
  const owner = await account(), sourceRunId = await owner.acquire();
  const context = { ...owner.command, sourceRunId, offset: "20", targetLanguage: "zh-Hans" };
  const url = `${origin}/api/translations/runs?${new URLSearchParams({ accountId: owner.ownerId, ...context })}`;
  const initial = await request.get(url, { headers: owner.headers });
  expect(initial.status()).toBe(200); expect(await initial.json()).toEqual({ ok: true, run: null });
  expect(initial.headers()["cache-control"]).toBe("private, no-store");
  const runId = randomUUID();
  expect((await owner.client.rpc("begin_translation_run", { p_request: { ...context, offset: 20, runId } })).error).toBeNull();
  const recovered = await request.get(url, { headers: owner.headers });
  expect(recovered.status()).toBe(200); expect((await recovered.json()).run).toMatchObject({ runId, status: "queued", observedAt: null, result: null });
  expect((await request.get(url)).status()).toBe(401);
  expect((await request.get(`${url}&offset=20`, { headers: owner.headers })).status()).toBe(422);
  expect((await request.get(`${url}&unexpected=true`, { headers: owner.headers })).status()).toBe(422);
  const other = await account();
  expect((await request.get(url, { headers: other.headers })).status()).toBe(403);
  const ownUrl = url.replace(owner.ownerId, other.ownerId);
  expect(await (await request.get(ownUrl, { headers: other.headers })).json()).toEqual({ ok: true, run: null });
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
});

test("the signed-in reader translates explicitly and restores the page from cloud history after reload", async ({ page, request }) => {
  test.skip(disabled);
  const owner = await account(); await owner.acquire();
  await page.context().addCookies(owner.cookies.map(cookie => ({ ...cookie, url: origin })));
  await page.goto(`/learn/${owner.bindingId}`);
  await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByRole("button", { name: "翻译当前页", exact: true })).toBeEnabled();
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
  await page.getByRole("button", { name: "翻译当前页", exact: true }).click();
  await expect(page.locator(".transcript-chinese p")).toHaveText("用自己的照片解释你的选择。");
  await page.reload(); await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".transcript-chinese p")).toHaveText("用自己的照片解释你的选择。");
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
});

test("reload before a start receipt exists reuses the same attempt instead of a second generation", async ({ page, request }) => {
  test.skip(disabled);
  const owner = await account(); await owner.acquire();
  await page.context().addCookies(owner.cookies.map(cookie => ({ ...cookie, url: origin })));
  const ids: string[] = [];
  await page.route(`${origin}/api/translations/runs`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    ids.push(route.request().postDataJSON().runId);
    if (ids.length === 1) return route.abort("connectionfailed");
    return route.continue();
  });
  await page.goto(`/learn/${owner.bindingId}`); await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
  await page.getByRole("button", { name: "翻译当前页", exact: true }).click();
  await expect(page.getByText(/结果尚未确认/)).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
  await page.getByRole("button", { name: "翻译当前页", exact: true }).click();
  await expect(page.getByRole("button", { name: "译文已就绪", exact: true })).toBeVisible();
  expect(ids).toHaveLength(2); expect(ids[1]).toBe(ids[0]);
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
});

test("twenty paired paragraphs remain readable in both themes at desktop and 320px", async ({ page, request }, info) => {
  test.skip(disabled);
  const owner = await account(); await owner.acquire();
  await page.context().addCookies(owner.cookies.map(cookie => ({ ...cookie, url: origin })));
  await page.goto(`/learn/${owner.bindingId}`); await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
  await page.getByRole("button", { name: "翻译当前页", exact: true }).click();
  await expect(page.getByRole("button", { name: "译文已就绪", exact: true })).toBeVisible();
  await expect(page.locator(".transcript-chinese p")).toHaveCount(20);
  const first = page.locator(".transcript-bilingual li").first();
  for (const theme of ["cyberpunk", "eastern"]) {
    await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const columns = await first.locator(".transcript-column").evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, height: rect.height };
      }));
      if (width > 700) { expect(columns[1].x).toBeGreaterThan(columns[0].x); expect(Math.abs(columns[1].y - columns[0].y)).toBeLessThan(1); }
      else expect(columns[1].y).toBeGreaterThanOrEqual(columns[0].y + columns[0].height);
      await first.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`) });
      await page.keyboard.press("Tab"); await first.locator("a").focus();
      expect(await first.locator("a").evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
      expect(await page.locator(".translation-tools button").evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height >= 44))).toBe(true);
    }
  }
  await page.emulateMedia({ forcedColors: "active" });
  await expect(first.locator("a")).toBeVisible();
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes("这是本地固定译文")))).toBe(false);
});

test("a real Cookie starts a source-bound translation through production Next and actual Edge", async ({ request }) => {
  test.skip(disabled);
  const traceUrl = new URL("../.next/server/app/api/translations/runs/route.js.nft.json", import.meta.url);
  const trace: { files: string[] } = JSON.parse(await readFile(traceUrl, "utf8"));
  const skills = trace.files.filter(path => path.endsWith("translate-transcript/v1/SKILL.md"));
  expect(skills).toHaveLength(1); await access(new URL(skills[0], traceUrl));
  const owner = await account();
  const command = { accountId: owner.ownerId, runId: randomUUID(), ...owner.command, sourceRunId: await owner.acquire(), offset: 20, targetLanguage: "zh-Hans" };
  const response = await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: command });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, runId: command.runId, status: "ready" });
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const readUrl = `${origin}/api/translations/runs/${command.runId}?accountId=${owner.ownerId}`;
  const read = await request.get(readUrl, { headers: owner.headers });
  expect(read.status()).toBe(200);
  expect(read.headers()["cache-control"]).toBe("private, no-store");
  const projection = await read.json();
  expect(projection).toEqual({ ok: true, run: {
    runId: command.runId, accountId: owner.ownerId, status: "ready", context: { ...owner.command, sourceRunId: command.sourceRunId, offset: 20 },
    targetLanguage: "zh-Hans", contentExpiresAt: expect.any(String), observedAt: expect.any(String),
    result: { status: "translated", providerMayHaveRun: true, usage: { inputTokens: 31, outputTokens: 12, totalTokens: 43 },
      segments: [{ segmentIndex: 20, translation: "用自己的照片解释你的选择。" }] },
  } });
  expect(Date.parse(projection.run.observedAt)).toBeLessThan(Date.parse(projection.run.contentExpiresAt));
  const repeated = await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: command });
  expect(repeated.status()).toBe(200);
  expect(await repeated.json()).toEqual({ ok: true, runId: command.runId, status: "ready" });
  await new Promise(resolve => setTimeout(resolve, 20));
  const recovered = await request.get(readUrl, { headers: owner.headers });
  const recoveredRun = (await recovered.json()).run;
  expect(recoveredRun.result).toEqual(projection.run.result);
  expect(recoveredRun.contentExpiresAt).toBe(projection.run.contentExpiresAt);
  expect(Date.parse(recoveredRun.observedAt)).toBeGreaterThan(Date.parse(projection.run.observedAt));
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
});

test("a real owner explicitly cancels a queued translation without model execution", async ({ request }) => {
  test.skip(disabled);
  const owner = await account(), runId = randomUUID();
  expect((await owner.client.rpc("begin_translation_run", { p_request: { runId, ...owner.command, sourceRunId: await owner.acquire(), offset: 20, targetLanguage: "zh-Hans" } })).error).toBeNull();
  const response = await request.post(`${origin}/api/translations/runs/${runId}`, { headers: owner.headers, data: { operation: "cancel", accountId: owner.ownerId } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, runId, status: "cancelled" });
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const read = await request.get(`${origin}/api/translations/runs/${runId}?accountId=${owner.ownerId}`, { headers: owner.headers });
  expect(read.status()).toBe(200);
  expect((await read.json()).run).toMatchObject({ status: "cancelled", observedAt: null,
    result: { status: "cancelled", providerMayHaveRun: false, usage: null } });
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
});

test("explicit cancellation releases a held production request without another inference", async ({ request }) => {
  test.skip(disabled);
  const owner = await account(), runId = randomUUID();
  const command = { accountId: owner.ownerId, runId, ...owner.command, sourceRunId: await owner.acquire(), offset: 20, targetLanguage: "zh-Hans" };
  expect((await request.post(`${provider}/fixture/hold`)).ok()).toBe(true);
  const controller = new AbortController();
  const execution = fetch(`${origin}/api/translations/runs`, { method: "POST", headers: { ...owner.headers, "content-type": "application/json" }, body: JSON.stringify(command), signal: controller.signal });
  try {
    await expect.poll(async () => (await (await request.get(`${provider}/fixture/calls`)).json()).length).toBe(1);
    const cancelled = await request.post(`${origin}/api/translations/runs/${runId}`, { headers: owner.headers, data: { operation: "cancel", accountId: owner.ownerId } });
    expect(cancelled.status()).toBe(200);
    expect(await cancelled.json()).toEqual({ ok: true, runId, status: "cancelled" });
    const completed = await execution;
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({ ok: true, runId, status: "cancelled" });
    const read = await request.get(`${origin}/api/translations/runs/${runId}?accountId=${owner.ownerId}`, { headers: owner.headers });
    expect((await read.json()).run).toMatchObject({ status: "cancelled", observedAt: null,
      result: { status: "cancelled", providerMayHaveRun: true, usage: null } });
    expect((await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: command })).status()).toBe(200);
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
  } finally { controller.abort(); await execution.catch(() => undefined); }
});

test("production execution and recovery reject foreign identities and unexpected wire fields", async ({ request }) => {
  test.skip(disabled);
  const owner = await account(), other = await account(), runId = randomUUID();
  const command = { accountId: owner.ownerId, runId, ...owner.command, sourceRunId: await owner.acquire(), offset: 20, targetLanguage: "zh-Hans" };
  const { accountId: _accountId, ...input } = command;
  expect((await owner.client.rpc("begin_translation_run", { p_request: input })).error).toBeNull();
  const readUrl = `${origin}/api/translations/runs/${runId}?accountId=${owner.ownerId}`;
  expect((await request.post(`${origin}/api/translations/runs`, { headers: { origin }, data: command })).status()).toBe(401);
  expect((await request.get(readUrl)).status()).toBe(401);
  const token = (await owner.client.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Missing isolated user session");
  for (const headers of [{ ...owner.headers, origin: "https://other.example.test" }, { ...owner.headers, origin: "" }, { ...owner.headers, authorization: `Bearer ${token}` }]) {
    expect((await request.post(`${origin}/api/translations/runs`, { headers, data: command })).status()).toBe(403);
    expect((await request.post(`${origin}/api/translations/runs/${runId}`, { headers, data: { operation: "cancel", accountId: owner.ownerId } })).status()).toBe(403);
  }
  expect((await request.get(readUrl, { headers: { ...owner.headers, authorization: `Bearer ${token}` } })).status()).toBe(403);
  expect((await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: { ...command, accountId: other.ownerId } })).status()).toBe(403);
  expect((await request.get(readUrl, { headers: other.headers })).status()).toBe(403);
  expect((await request.get(`${origin}/api/translations/runs/${runId}?accountId=${other.ownerId}`, { headers: other.headers })).status()).toBe(404);
  expect((await request.post(`${origin}/api/translations/runs/${runId}`, { headers: other.headers, data: { operation: "cancel", accountId: other.ownerId } })).status()).toBe(404);
  for (const body of [{ ...command, sourceText: "not accepted" }, { ...command, targetLanguage: "en" }, { ...command, offset: 1 }, { ...command, runId: "bad" }]) {
    expect((await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: body })).status()).toBe(422);
  }
  for (const suffix of ["", `?accountId=${owner.ownerId}&accountId=${owner.ownerId}`, `?accountId=${owner.ownerId}&extra=true`, "?accountId=invalid"]) {
    expect((await request.get(`${origin}/api/translations/runs/${runId}${suffix}`, { headers: owner.headers })).status()).toBe(422);
  }
  expect((await request.post(`${origin}/api/translations/runs/${runId}`, { headers: owner.headers, data: { operation: "cancel", accountId: owner.ownerId, result: null } })).status()).toBe(422);
  expect((await (await request.get(readUrl, { headers: owner.headers })).json()).run.status).toBe("queued");
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
});

test("production input limits and upload deadlines do not consume a model request", async ({ request }) => {
  test.skip(disabled);
  const owner = await account();
  const headers = { ...owner.headers, "content-type": "application/json" };
  for (const path of ["/api/translations/runs", `/api/translations/runs/${randomUUID()}`]) {
    expect((await request.post(`${origin}${path}`, { headers, data: "字".repeat(11000) })).status()).toBe(413);
    expect((await request.post(`${origin}${path}`, { headers, data: Buffer.from([0xc3, 0x28]) })).status()).toBe(422);
    expect((await request.post(`${origin}${path}`, { headers: { ...headers, "content-type": "text/plain" }, data: "{}" })).status()).toBe(422);
    const result = await new Promise<{ status: number; body: string; cache: string | undefined }>((resolve, reject) => {
      const pending = httpRequest(`${origin}${path}`, { method: "POST", headers }, response => {
        let body = ""; response.on("data", chunk => { body += chunk; });
        response.on("end", () => { clearTimeout(timer); pending.destroy(); resolve({ status: response.statusCode!, body, cache: response.headers["cache-control"] }); });
      });
      const timer = setTimeout(() => { pending.destroy(); reject(new Error("Translation upload exceeded 15 seconds")); }, 15_000);
      pending.on("error", error => { clearTimeout(timer); reject(error); });
      pending.write("{");
    });
    expect(result).toEqual({ status: 408, body: '{"ok":false,"code":"invalid"}', cache: "private, no-store" });
  }
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
});

for (const change of ["clear", "expiry"] as const) test(`ready translation loses its content after source ${change} without regeneration`, async ({ request }) => {
  test.skip(disabled);
  const owner = await account();
  const sourceRunId = await owner.acquire(change === "expiry" ? 3 : 600), runId = randomUUID();
  const command = { accountId: owner.ownerId, runId, ...owner.command, sourceRunId, offset: 20, targetLanguage: "zh-Hans" };
  const started = await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: command });
  expect(started.status()).toBe(200); expect(await started.json()).toEqual({ ok: true, runId, status: "ready" });
  const readUrl = `${origin}/api/translations/runs/${runId}?accountId=${owner.ownerId}`;
  const ready = await request.get(readUrl, { headers: owner.headers });
  expect(ready.status()).toBe(200);
  expect((await ready.json()).run.result.status).toBe("translated");
  if (change === "clear") expect((await owner.client.rpc("clear_resource_evidence", { p_run_id: sourceRunId })).error).toBeNull();
  else await new Promise(resolve => setTimeout(resolve, 3300));
  const cleared = await request.get(readUrl, { headers: owner.headers });
  expect(cleared.status()).toBe(200);
  expect((await cleared.json()).run).toMatchObject({ status: "cleared", observedAt: null, result: null });
  const recovered = await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: command });
  expect(recovered.status()).toBe(200); expect(await recovered.json()).toEqual({ ok: true, runId, status: "cleared" });
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
});

test("disabled generation without model or worker credentials still reads ready content and cancels queued work", async ({ request }) => {
  test.skip(!disabled);
  const owner = await account(), sourceRunId = await owner.acquire(), runId = randomUUID(), leaseId = randomUUID();
  const input = { runId, ...owner.command, sourceRunId, offset: 20, targetLanguage: "zh-Hans" };
  expect((await owner.client.rpc("begin_translation_run", { p_request: input })).error).toBeNull();
  const instructions = await readFile(new URL("../src/lib/agent/skills/translate-transcript/v1/SKILL.md", import.meta.url), "utf8");
  const skill = { name: "blueprint-translate-transcript", version: "1.0.0", instructions, sha256: createHash("sha256").update(instructions).digest("hex") };
  expect((await owner.admin.rpc("claim_translation_run", { p_owner_id: owner.ownerId, p_run_id: runId, p_lease_id: leaseId, p_skill: skill, p_model: "prepared-local-fixture" })).error).toBeNull();
  const result = { status: "translated", providerMayHaveRun: true, usage: null, segments: [{ segmentIndex: 20, translation: "本地预置的历史译文；不是模型质量证据。" }] };
  expect((await owner.admin.rpc("finish_translation_run", { p_owner_id: owner.ownerId, p_run_id: runId, p_lease_id: leaseId, p_result: result })).error).toBeNull();
  const read = await request.get(`${origin}/api/translations/runs/${runId}?accountId=${owner.ownerId}`, { headers: owner.headers });
  expect(read.status()).toBe(200); expect((await read.json()).run).toMatchObject({ status: "ready", observedAt: expect.any(String), result });
  const deniedRunId = randomUUID();
  const denied = await request.post(`${origin}/api/translations/runs`, { headers: owner.headers, data: { ...input, runId: deniedRunId, accountId: owner.ownerId } });
  expect(denied.status()).toBe(503); expect(await denied.json()).toEqual({ ok: false, code: "disabled" });
  expect((await request.get(`${origin}/api/translations/runs/${deniedRunId}?accountId=${owner.ownerId}`, { headers: owner.headers })).status()).toBe(404);
  const queuedId = randomUUID();
  expect((await owner.client.rpc("begin_translation_run", { p_request: { ...input, runId: queuedId } })).error).toBeNull();
  const cancelled = await request.post(`${origin}/api/translations/runs/${queuedId}`, { headers: owner.headers, data: { operation: "cancel", accountId: owner.ownerId } });
  expect(cancelled.status()).toBe(200); expect(await cancelled.json()).toEqual({ ok: true, runId: queuedId, status: "cancelled" });
  expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
});
