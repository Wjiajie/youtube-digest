type BodyResult = { ok: true; value: unknown } | { ok: false; status: 408 | 413 | 422 };

/** Execution uploads share one absolute deadline, not a timeout restarted per chunk. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<BodyResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 422 };
  let size = 0, text = "", timer: ReturnType<typeof setTimeout> | undefined;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const timeout = new DOMException("Read deadline", "TimeoutError");
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(timeout), 5000); });
  let onAbort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DOMException("Upload aborted", "AbortError"));
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline, cancelled]);
      if (request.signal.aborted) throw new DOMException("Upload aborted", "AbortError");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => {}); return { ok: false, status: 413 }; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    // Teardown belongs to the sender. A stalled/rejected cancellation cannot hold the response open.
    void reader.cancel().catch(() => {});
    return { ok: false, status: error === timeout ? 408 : 422 };
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", onAbort); reader.releaseLock(); }
}
