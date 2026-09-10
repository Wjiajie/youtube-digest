import type { ProviderFailure } from "./types";

type JsonResult = { ok: true; status: number; data: unknown } | { ok: false; failure: ProviderFailure };
const maximumBytes = 1024 * 1024;

/** One deadline covers fetch and streaming body; abort need not be honored by an injected transport. */
export async function requestProviderJson(fetcher: typeof fetch, url: URL, headers: HeadersInit, signal: AbortSignal): Promise<JsonResult> {
  if (signal.aborted) return { ok: false, failure: { status: "cancelled" } };
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let settleCancellation: (result: JsonResult) => void = () => {};
  const cancellation = new Promise<JsonResult>(resolve => { settleCancellation = resolve; });
  function cancel(status: "cancelled" | "timed_out") {
    settleCancellation({ ok: false, failure: { status } });
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
  const onAbort = () => cancel("cancelled");
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => cancel("timed_out"), 10_000);
  async function read(): Promise<JsonResult> {
    try {
      const response = await fetcher(url, { method: "GET", headers, signal: controller.signal, redirect: "error", cache: "no-store" });
      if (controller.signal.aborted || response.status !== 200 && response.status !== 202) {
        void response.body?.cancel().catch(() => {});
        const status = response.status === 404 ? "not_found" : response.status === 429 ? "rate_limited" : response.status === 408 || response.status === 504 ? "timed_out" : "unavailable";
        return { ok: false, failure: { status } };
      }
      reader = response.body?.getReader();
      const length = response.headers.get("content-length");
      if (!reader || length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) return { ok: false, failure: { status: "unavailable" } };
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (controller.signal.aborted) return { ok: false, failure: { status: "unavailable" } };
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximumBytes) return { ok: false, failure: { status: "unavailable" } };
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { ok: true, status: response.status, data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
    } catch { return { ok: false, failure: { status: "unavailable" } }; }
    finally { void reader?.cancel().catch(() => {}); }
  }
  try { return await Promise.race([cancellation, read()]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}
