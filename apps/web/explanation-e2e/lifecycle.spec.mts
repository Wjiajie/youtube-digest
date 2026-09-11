import { test, expect } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { explanationAccount, origin, provider, disabled, answer, selection, ensure } from "./fixture.mts";

test("explicit cancellation releases a held explanation and replay never starts a second inference", async ({ request }) => {
  test.skip(disabled);
  const owner = await explanationAccount(), controller = new AbortController();
  let execution: Promise<Response> | undefined;
  try {
    await request.post(`${provider}/fixture/reset`);
    const command = owner.commandFor(await owner.acquire(), randomUUID()), base = `${origin}/api/explanations/runs`;
    await request.post(`${provider}/fixture/hold`);
    execution = fetch(base, { method: "POST", headers: { ...owner.headers, "content-type": "application/json" }, body: JSON.stringify(command), signal: controller.signal });
    await expect.poll(async () => (await (await request.get(`${provider}/fixture/calls`)).json()).length).toBe(1);
    const cancelled = await request.post(`${base}/${command.runId}`, { headers: owner.headers, data: { operation: "cancel", accountId: owner.ownerId } });
    expect(cancelled.status()).toBe(200); expect(await cancelled.json()).toEqual({ ok: true, runId: command.runId, status: "cancelled" });
    const completed = await execution;
    expect(completed.status).toBe(200); expect(await completed.json()).toEqual({ ok: true, runId: command.runId, status: "cancelled" });
    const read = await request.get(`${base}/${command.runId}?accountId=${owner.ownerId}`, { headers: owner.headers });
    expect((await read.json()).run).toMatchObject({ status: "cancelled", observedAt: expect.any(String), selection,
      result: { status: "cancelled", providerMayHaveRun: true, usage: null } });
    expect((await request.post(base, { headers: owner.headers, data: command })).status()).toBe(200);
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toHaveLength(1);
  } finally { controller.abort(); await execution?.catch(() => undefined); await owner.cleanup(); }
});

for (const change of ["clear", "expiry"] as const) test(`source ${change} erases answer, selection and question but retains exact recovery identity`, async ({ request }) => {
  test.skip(disabled);
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`);
    const command = owner.commandFor(await owner.acquire(change === "expiry" ? 3 : 600), randomUUID()), base = `${origin}/api/explanations/runs`;
    const { runId, ...lookup } = command;
    const started = await request.post(base, { headers: owner.headers, data: command });
    expect(started.status()).toBe(200); expect(await started.json()).toEqual({ ok: true, runId, status: "ready" });
    const read = () => request.get(`${base}/${runId}?accountId=${owner.ownerId}`, { headers: owner.headers });
    if (change === "clear") ensure((await owner.client.rpc("clear_resource_evidence", { p_run_id: command.sourceRunId })).error);
    await expect.poll(async () => (await (await read()).json()).run.status, { timeout: 15000 }).toBe("cleared");
    const cleared = await read(); expect(cleared.status()).toBe(200);
    expect((await cleared.json()).run).toMatchObject({ runId, status: "cleared", observedAt: null, selection: null, question: null, result: null });
    const recovered = await request.post(`${base}/find`, { headers: owner.headers, data: lookup });
    expect(recovered.status()).toBe(200); expect((await recovered.json()).run).toMatchObject({ runId, status: "cleared", result: null });
    expect(await (await request.post(`${base}/find`, { headers: owner.headers, data: { ...lookup, question: "不同问题" } })).json()).toEqual({ ok: true, run: null });
    expect(await (await request.post(base, { headers: owner.headers, data: command })).json()).toEqual({ ok: true, runId, status: "cleared" });
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toHaveLength(1);
  } finally { await owner.cleanup(); }
});

test("without model or Worker keys users still read and find ready history and cancel queued work", async ({ request }) => {
  test.skip(!disabled);
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`);
    const command = owner.commandFor(await owner.acquire(), randomUUID()), base = `${origin}/api/explanations/runs`;
    const { accountId, ...input } = command, { runId, ...lookup } = command, leaseId = randomUUID();
    ensure((await owner.client.rpc("begin_explanation_run", { p_request: input })).error);
    const instructions = await readFile(new URL("../src/lib/agent/skills/explain-selection/v1/SKILL.md", import.meta.url), "utf8");
    const skill = { name: "blueprint-explain-selection", version: "1.0.0", instructions, sha256: createHash("sha256").update(instructions).digest("hex") };
    ensure((await owner.admin.rpc("claim_explanation_run", { p_owner_id: accountId, p_run_id: runId, p_lease_id: leaseId, p_skill: skill, p_model: "prepared-local-fixture" })).error);
    const result = { status: "explained", providerMayHaveRun: true, usage: null, answer };
    ensure((await owner.admin.rpc("finish_explanation_run", { p_owner_id: accountId, p_run_id: runId, p_lease_id: leaseId, p_result: result })).error);
    const read = await request.get(`${base}/${runId}?accountId=${accountId}`, { headers: owner.headers });
    expect(read.status()).toBe(200); expect((await read.json()).run).toMatchObject({ status: "ready", observedAt: expect.any(String), result });
    expect((await (await request.post(`${base}/find`, { headers: owner.headers, data: lookup })).json()).run.result).toEqual(result);
    const deniedId = randomUUID(), denied = await request.post(base, { headers: owner.headers, data: { ...command, runId: deniedId } });
    expect(denied.status()).toBe(503); expect(await denied.json()).toEqual({ ok: false, code: "disabled" });
    expect((await request.get(`${base}/${deniedId}?accountId=${accountId}`, { headers: owner.headers })).status()).toBe(404);
    const queuedId = randomUUID(); ensure((await owner.client.rpc("begin_explanation_run", { p_request: { ...input, runId: queuedId } })).error);
    const cancel = await request.post(`${base}/${queuedId}`, { headers: owner.headers, data: { operation: "cancel", accountId } });
    expect(cancel.status()).toBe(200); expect(await cancel.json()).toEqual({ ok: true, runId: queuedId, status: "cancelled" });
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
  } finally { await owner.cleanup(); }
});
