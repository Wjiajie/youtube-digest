import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { explanationAccount, origin, provider, ensure } from "./fixture.mts";

test("Web guards reject foreign identity, CSRF, URL questions and unexpected fields without changing queued work", async ({ request }) => {
  const owner = await explanationAccount();
  let other: Awaited<ReturnType<typeof explanationAccount>> | undefined;
  try {
    other = await explanationAccount();
    await request.post(`${provider}/fixture/reset`);
    const command = owner.commandFor(await owner.acquire(), randomUUID()), base = `${origin}/api/explanations/runs`;
    const { accountId, ...input } = command, { runId, ...lookup } = command;
    ensure((await owner.client.rpc("begin_explanation_run", { p_request: input })).error);
    const readUrl = `${base}/${runId}?accountId=${accountId}`;
    expect((await request.post(base, { headers: { origin }, data: command })).status()).toBe(401);
    expect((await request.get(readUrl)).status()).toBe(401);
    const token = (await owner.client.auth.getSession()).data.session!.access_token;
    for (const headers of [{ ...owner.headers, origin: "https://other.example.test" }, { ...owner.headers, origin: "" }, { ...owner.headers, authorization: `Bearer ${token}` }]) {
      for (const [url, data] of [[base, command], [`${base}/find`, lookup], [`${base}/${runId}`, { operation: "cancel", accountId }]] as const)
        expect((await request.post(url, { headers, data })).status()).toBe(403);
    }
    expect((await request.get(readUrl, { headers: { ...owner.headers, authorization: `Bearer ${token}` } })).status()).toBe(403);
    expect((await request.post(base, { headers: owner.headers, data: { ...command, accountId: other.ownerId } })).status()).toBe(403);
    expect((await request.get(readUrl, { headers: other.headers })).status()).toBe(403);
    expect((await request.get(`${base}/${runId}?accountId=${other.ownerId}`, { headers: other.headers })).status()).toBe(404);
    expect((await request.post(`${base}/${runId}`, { headers: other.headers, data: { operation: "cancel", accountId: other.ownerId } })).status()).toBe(404);
    expect(await (await request.post(`${base}/find`, { headers: other.headers, data: { ...lookup, accountId: other.ownerId } })).json()).toEqual({ ok: true, run: null });
    for (const patch of [{ sourceText: "not accepted" }, { targetLanguage: "en" }, { offset: 1 }, { runId: "bad" }, { question: "\ud800" }, { question: "nul\u0000" }])
      expect((await request.post(base, { headers: owner.headers, data: { ...command, ...patch } })).status()).toBe(422);
    for (const suffix of ["", `?accountId=${accountId}&accountId=${accountId}`, `?accountId=${accountId}&question=must-not-be-used`, "?accountId=invalid"])
      expect((await request.get(`${base}/${runId}${suffix}`, { headers: owner.headers })).status()).toBe(422);
    for (const [url, data] of [[base, command], [`${base}/find`, lookup], [`${base}/${runId}`, { operation: "cancel", accountId }]] as const)
      expect((await request.post(`${url}?unexpected=true`, { headers: owner.headers, data })).status()).toBe(422);
    expect((await request.post(`${base}/find`, { headers: owner.headers, data: { ...lookup, runId } })).status()).toBe(422);
    expect((await request.get(`${base}/find`, { headers: owner.headers })).status()).toBe(405);
    expect((await request.post(`${base}/${runId}`, { headers: owner.headers, data: { operation: "cancel", accountId, result: null } })).status()).toBe(422);
    expect((await (await request.get(readUrl, { headers: owner.headers })).json()).run.status).toBe("queued");
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
  } finally { try { await owner.cleanup(); } finally { await other?.cleanup(); } }
});

test("slow external Auth cannot hold a private explanation request beyond its ten-second budget", async ({ request }) => {
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`);
    await request.post(`${provider}/fixture/hold-auth`);
    const startedAt = performance.now();
    const response = await request.get(`${origin}/api/explanations/runs/${randomUUID()}?accountId=${owner.ownerId}`, { headers: owner.headers, timeout: 15000 });
    expect(response.status()).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "unavailable" });
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(9500); expect(elapsed).toBeLessThan(14000);
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
  } finally { await request.post(`${provider}/fixture/reset`); await owner.cleanup(); }
});

test("all explanation writes enforce byte limits, UTF-8 and absolute upload deadlines", async ({ request }) => {
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`);
    const headers = { ...owner.headers, "content-type": "application/json" };
    for (const path of ["/api/explanations/runs", "/api/explanations/runs/find", `/api/explanations/runs/${randomUUID()}`]) {
      expect((await request.post(`${origin}${path}`, { headers, data: "字".repeat(11000) })).status()).toBe(413);
      expect((await request.post(`${origin}${path}`, { headers, data: Buffer.from([0xc3, 0x28]) })).status()).toBe(422);
      expect((await request.post(`${origin}${path}`, { headers: { ...headers, "content-type": "text/plain" }, data: "{}" })).status()).toBe(422);
      const result = await new Promise<{ status: number | undefined; body: string; cache: string | undefined }>((resolve, reject) => {
        const pending = httpRequest(`${origin}${path}`, { method: "POST", headers }, response => {
          let body = ""; response.on("data", chunk => { body += chunk; });
          response.on("end", () => { clearTimeout(timer); pending.destroy(); resolve({ status: response.statusCode, body, cache: response.headers["cache-control"] }); });
        });
        const timer = setTimeout(() => { pending.destroy(); reject(new Error("Explanation upload exceeded 15 seconds")); }, 15000);
        pending.on("error", error => { clearTimeout(timer); reject(error); }); pending.write("{");
      });
      expect(result).toEqual({ status: 408, body: '{"ok":false,"code":"invalid"}', cache: "private, no-store" });
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(await (await request.get(`${provider}/fixture/uncaught`)).json()).toEqual({ count: 0 });
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
  } finally { await owner.cleanup(); }
});
