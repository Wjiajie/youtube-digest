import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { explanationAccount, origin, provider, disabled, answer, selection, ensure } from "./fixture.mts";

test("a real Cookie explains once through production Next and actual Edge, then restores by exact body-only lookup", async ({ request }) => {
  test.skip(disabled);
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`);
    const command = owner.commandFor(await owner.acquire(), randomUUID());
    const { runId, ...lookup } = command;
    const initial = await request.post(`${origin}/api/explanations/runs/find`, { headers: owner.headers, data: lookup });
    expect(initial.status()).toBe(200); expect(await initial.json()).toEqual({ ok: true, run: null });
    const response = await request.post(`${origin}/api/explanations/runs`, { headers: owner.headers, data: command });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId, status: "ready" });
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const read = await request.get(`${origin}/api/explanations/runs/${runId}?accountId=${owner.ownerId}`, { headers: owner.headers });
    expect(read.status()).toBe(200); expect(read.headers()["x-content-type-options"]).toBe("nosniff");
    const projection = await read.json();
    expect(projection).toEqual({ ok: true, run: {
      runId, accountId: owner.ownerId, status: "ready", context: { ...owner.command, sourceRunId: command.sourceRunId, offset: 20 },
      targetLanguage: "zh-Hans", contentExpiresAt: expect.any(String), observedAt: expect.any(String), selection, question: "怎样练习？",
      result: { status: "explained", providerMayHaveRun: true, usage: { inputTokens: 31, outputTokens: 12, totalTokens: 43 }, answer },
    } });
    expect(Date.parse(projection.run.observedAt)).toBeLessThan(Date.parse(projection.run.contentExpiresAt));
    const repeated = await request.post(`${origin}/api/explanations/runs`, { headers: owner.headers, data: command });
    expect(await repeated.json()).toEqual({ ok: true, runId, status: "ready" });
    const found = await request.post(`${origin}/api/explanations/runs/find`, { headers: owner.headers, data: lookup });
    expect(found.status()).toBe(200); expect((await found.json()).run.result).toEqual(projection.run.result);
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
  } finally { await owner.cleanup(); }
});

test("an owner reads and explicitly cancels queued explanation without starting a model", async ({ request }) => {
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`);
    const command = owner.commandFor(await owner.acquire(), randomUUID());
    const { accountId, ...input } = command;
    ensure((await owner.client.rpc("begin_explanation_run", { p_request: input })).error);
    const url = `${origin}/api/explanations/runs/${input.runId}`;
    const pending = await request.get(`${url}?accountId=${accountId}`, { headers: owner.headers });
    expect(pending.status()).toBe(200);
    expect((await pending.json()).run).toMatchObject({ status: "queued", selection, question: "怎样练习？", observedAt: expect.any(String), result: null });
    const cancelled = await request.post(url, { headers: owner.headers, data: { operation: "cancel", accountId } });
    expect(cancelled.status()).toBe(200);
    expect(await cancelled.json()).toEqual({ ok: true, runId: input.runId, status: "cancelled" });
    expect(cancelled.headers()["cache-control"]).toBe("private, no-store");
    const read = await request.get(`${url}?accountId=${accountId}`, { headers: owner.headers });
    expect((await read.json()).run).toMatchObject({ status: "cancelled", selection, question: "怎样练习？", observedAt: expect.any(String),
      result: { status: "cancelled", providerMayHaveRun: false, usage: null } });
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
  } finally { await owner.cleanup(); }
});
