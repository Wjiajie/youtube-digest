import { afterEach, expect, it, vi } from "vitest";
import { readBoundedJson } from "./read-bounded-json";

afterEach(() => vi.useRealTimers());
function request(body: ReadableStream<Uint8Array>) {
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" };
  return new Request("https://blueprint.example/fixture", init);
}

it("does not mistake a sender's TimeoutError for the application's upload deadline", async () => {
  vi.useFakeTimers();
  const input = request(new ReadableStream({ start(controller) { controller.error(new DOMException("PRIVATE_STREAM_REASON", "TimeoutError")); } }));
  expect(await readBoundedJson(input, 2048)).toEqual({ ok: false, status: 422 });
  expect(input.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it("decodes split multi-byte text exactly and releases its reader and deadline after success", async () => {
  vi.useFakeTimers();
  const bytes = new TextEncoder().encode('{"message":"学摄影📷"}');
  const input = request(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } }));
  expect(await readBoundedJson(input, 2048)).toEqual({ ok: true, value: { message: "学摄影📷" } });
  expect(input.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it.each(["timeout", "oversize", "invalid"] as const)("releases reader and timer after %s even if stream teardown never completes", async kind => {
  vi.useFakeTimers();
  const input = request(new ReadableStream<Uint8Array>({ start(controller) {
    if (kind === "oversize") controller.enqueue(new Uint8Array(2049).fill(32));
    if (kind === "invalid") controller.enqueue(Uint8Array.of(0xff));
  }, cancel: () => new Promise(() => {}) }));
  const pending = readBoundedJson(input, 2048);
  await vi.advanceTimersByTimeAsync(kind === "timeout" ? 5000 : 0);
  expect(await pending).toEqual({ ok: false, status: kind === "timeout" ? 408 : kind === "oversize" ? 413 : 422 });
  expect(input.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it("honors a shorter caller budget on the original body without replacing the request signal", async () => {
  vi.useFakeTimers();
  const input = request(new ReadableStream<Uint8Array>()), budget = new AbortController();
  const pending = readBoundedJson(input, 2048, budget.signal);
  budget.abort();
  await vi.advanceTimersByTimeAsync(0);
  const result = await Promise.race([pending, Promise.resolve("still reading")]);
  // Drain a failing implementation too, so this regression leaves no unfinished read.
  await vi.advanceTimersByTimeAsync(5000); await pending;
  expect(result).toEqual({ ok: false, status: 422 });
  expect(input.signal.aborted).toBe(false);
  expect(input.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
