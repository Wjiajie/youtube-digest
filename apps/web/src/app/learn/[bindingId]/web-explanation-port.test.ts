import { expect, it } from "vitest";
import { createWebExplanationPort } from "./web-explanation-port";

const accountId = "a6000000-0000-4000-8000-000000000001", runId = "a6000000-0000-4000-8000-000000000002";
const context = { bindingId: "a6000000-0000-4000-8000-000000000003", videoId: "abcdefghijk",
  sourceRunId: "a6000000-0000-4000-8000-000000000004", offset: 20, targetLanguage: "zh-Hans" as const,
  selection: { start: { segmentIndex: 20, charOffset: 0 }, end: { segmentIndex: 20, charOffset: 2 } }, question: "我的私密问题？" };

it("looks up the exact question only in a same-origin Cookie POST body", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const port = createWebExplanationPort(accountId, async (path, init) => {
    calls.push({ path: String(path), init }); return Response.json({ ok: true, run: null });
  });
  expect(await port.find(context, new AbortController().signal)).toEqual({ ok: true, run: null });
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe("/api/explanations/runs/find");
  expect(calls[0].init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" });
  expect(new Headers(calls[0].init?.headers).has("authorization")).toBe(false);
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ accountId, ...context });
});

it("starts, reads and cancels the same bound attempt without leaking draft text into URL", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const port = createWebExplanationPort(accountId, async (path, init) => {
    calls.push({ path: String(path), init });
    if (init?.method === "GET") return Response.json({ ok: true, run: { runId, accountId, status: "queued",
      context: { bindingId: context.bindingId, videoId: context.videoId, sourceRunId: context.sourceRunId, offset: context.offset },
      targetLanguage: "zh-Hans", contentExpiresAt: "2026-09-11T02:00:00Z", observedAt: "2026-09-11T01:00:00Z", selection: context.selection, question: context.question, result: null } });
    return Response.json({ ok: true, runId, status: calls.length === 1 ? "queued" : "cancelled" });
  });
  const signal = new AbortController().signal;
  expect(await port.start({ ...context, runId }, signal)).toEqual({ ok: true, runId, status: "queued" });
  expect(await port.read({ ...context, runId }, signal)).toMatchObject({ ok: true, run: { runId, status: "queued" } });
  expect(await port.cancel({ ...context, runId }, signal)).toEqual({ ok: true, runId, status: "cancelled" });
  expect(calls.map(call => [call.path, call.init?.method])).toEqual([
    ["/api/explanations/runs", "POST"], [`/api/explanations/runs/${runId}?accountId=${accountId}`, "GET"], [`/api/explanations/runs/${runId}`, "POST"],
  ]);
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ accountId, ...context, runId });
  expect(JSON.parse(String(calls[2].init?.body))).toEqual({ accountId, operation: "cancel" });
});

it("discards an unusable response body without waiting for its sender to close", async () => {
  let cancelled = false;
  const port = createWebExplanationPort(accountId, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("private failure")); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }), { status: 503, headers: { "content-type": "text/plain" } }));
  await expect(port.find(context, new AbortController().signal)).rejects.toThrow("Explanation request unavailable");
  expect(cancelled).toBe(true);
});

it.each(["oversized", "invalid-utf8", "malformed-json", "wrong-account", "wrong-question", "private-receipt"])("rejects %s response without returning private content", async kind => {
  const projection = { runId, accountId, status: "queued", context: { bindingId: context.bindingId, videoId: context.videoId, sourceRunId: context.sourceRunId, offset: 20 },
    targetLanguage: "zh-Hans", contentExpiresAt: "2026-09-11T02:00:00Z", observedAt: "2026-09-11T01:00:00Z", selection: context.selection, question: context.question, result: null };
  const port = createWebExplanationPort(accountId, async () => {
    if (kind === "oversized") return new Response(" ".repeat(128 * 1024 + 1), { headers: { "content-type": "application/json" } });
    if (kind === "invalid-utf8") return new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } });
    if (kind === "malformed-json") return new Response("{private", { headers: { "content-type": "application/json" } });
    return Response.json({ ok: true, run: { ...projection, ...(kind === "wrong-account" ? { accountId: runId }
      : kind === "wrong-question" ? { question: "别人的问题" } : { input_page: "private" }) } });
  });
  await expect(port.read({ ...context, runId }, new AbortController().signal)).rejects.toThrow("Explanation request unavailable");
});

it("cancels a stalled response body while its cleanup is also stalled", async () => {
  let cancelStarted = false;
  const controller = new AbortController();
  const port = createWebExplanationPort(accountId, async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancelStarted = true; return new Promise(() => {}); },
  }), { headers: { "content-type": "application/json" } }));
  const pending = port.find(context, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await expect(pending).rejects.toThrow("Explanation request unavailable");
  expect(cancelStarted).toBe(true);
});

it("rejects an aborted request before making any network call", async () => {
  let count = 0;
  const port = createWebExplanationPort(accountId, async () => { count++; return Response.json({ ok: true, run: null }); });
  const controller = new AbortController(); controller.abort();
  await expect(port.find(context, controller.signal)).rejects.toThrow("Explanation request unavailable");
  expect(count).toBe(0);
});

it("does not accept an acknowledgement for a different attempt", async () => {
  const port = createWebExplanationPort(accountId, async () => Response.json({ ok: true, runId: accountId, status: "ready" }));
  await expect(port.start({ ...context, runId }, new AbortController().signal)).rejects.toThrow("Explanation request unavailable");
});

it("preserves only an exact disabled start refusal so a new unconsumed draft can remain editable", async () => {
  const port = createWebExplanationPort(accountId, async () => Response.json({ ok: false, code: "disabled" }, { status: 503 }));
  expect(await port.start({ ...context, runId }, new AbortController().signal)).toEqual({ ok: false, code: "disabled" });
  await expect(port.find(context, new AbortController().signal)).rejects.toThrow("Explanation request unavailable");
  await expect(port.cancel({ ...context, runId }, new AbortController().signal)).rejects.toThrow("Explanation request unavailable");
});

it.each([
  { status: 503, body: { ok: false, code: "disabled", detail: "private" } },
  { status: 503, body: { ok: false, code: "unavailable" } },
  { status: 403, body: { ok: false, code: "disabled" } },
  { status: 200, body: { ok: false, code: "disabled" } },
])("does not interpret a different failure as a definitive unused start ($status)", async ({ status, body }) => {
  const port = createWebExplanationPort(accountId, async () => Response.json(body, { status }));
  await expect(port.start({ ...context, runId }, new AbortController().signal)).rejects.toThrow("Explanation request unavailable");
});

it("keeps an aborted disabled body uncertain", async () => {
  const controller = new AbortController();
  const port = createWebExplanationPort(accountId, async () => {
    controller.abort(); return Response.json({ ok: false, code: "disabled" }, { status: 503 });
  });
  await expect(port.start({ ...context, runId }, controller.signal)).rejects.toThrow("Explanation request unavailable");
});
