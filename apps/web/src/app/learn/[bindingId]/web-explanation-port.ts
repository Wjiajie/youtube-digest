import { z } from "zod";
import { explanationAck, explanationCommand, explanationResponse, type ExplanationPort } from "@blueprint/ui/explanation-view";

/** Browser-only transport: the account travels as an expectation, never as an
 * identity credential. Cookies remain same-origin and questions stay out of URLs. */
export function createWebExplanationPort(accountId: string, fetcher: typeof fetch = fetch): ExplanationPort {
  const account = z.uuid().parse(accountId).toLowerCase(), base = "/api/explanations/runs";
  async function execute(input: unknown, signal: AbortSignal) {
      const command = explanationCommand.parse(input);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(command.operation === "start" ? 120_000 : 10_000)]);
      if (deadline.aborted) throw new Error("Explanation request unavailable");
      let onAbort = () => {}, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error("Explanation request unavailable"));
        deadline.addEventListener("abort", onAbort, { once: true });
        if (deadline.aborted) onAbort();
      });
      try {
        deadline.throwIfAborted();
        const path = command.operation === "find" ? `${base}/find` : command.operation === "start" ? base
          : `${base}/${encodeURIComponent(command.runId)}${command.operation === "read" ? `?${new URLSearchParams({ accountId: account })}` : ""}`;
        const body = command.operation === "read" ? undefined : command.operation === "cancel" ? { accountId: account, operation: "cancel" }
          : { accountId: account, ...command.context, ...(command.operation === "start" ? { runId: command.runId } : {}) };
        const response = await Promise.race([fetcher(path, { method: command.operation === "read" ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
          signal: deadline, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }), aborted]);
        const disabledCandidate = command.operation === "start" && response.status === 503;
        if (!response.ok && !disabledCandidate || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
          void response.body?.cancel().catch(() => {});
          throw new Error("Explanation request unavailable");
        }
        reader = response.body?.getReader();
        if (!reader) throw new Error("Explanation request unavailable");
        const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
        while (true) {
          const chunk = await Promise.race([reader.read(), aborted]);
          deadline.throwIfAborted();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 128 * 1024) throw new Error("Explanation request unavailable");
          text += decoder.decode(chunk.value, { stream: true });
        }
        const payload: unknown = JSON.parse(text + decoder.decode());
        deadline.throwIfAborted();
        if (disabledCandidate) return z.strictObject({ ok: z.literal(false), code: z.literal("disabled") }).parse(payload);
        if (command.operation === "start" || command.operation === "cancel") {
          const acknowledgement = explanationAck.parse(payload);
          if (acknowledgement.runId !== command.runId) throw new Error("Explanation request unavailable");
          return acknowledgement;
        }
        const result = explanationResponse.parse(payload);
        const run = result.run, context = command.context;
        if (command.operation === "read" && (!run || run.runId !== command.runId)) throw new Error("Explanation request unavailable");
        if (run && (run.accountId !== account || run.context.bindingId !== context.bindingId || run.context.videoId !== context.videoId
          || run.context.sourceRunId !== context.sourceRunId || run.context.offset !== context.offset || run.targetLanguage !== context.targetLanguage
          || run.status !== "cleared" && (run.question !== context.question || JSON.stringify(run.selection) !== JSON.stringify(context.selection))))
          throw new Error("Explanation request unavailable");
        return result;
      } catch { throw new Error("Explanation request unavailable"); }
      finally { deadline.removeEventListener("abort", onAbort); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } }
  }
  return {
    find: (context, signal) => execute({ operation: "find", context }, signal),
    start: ({ runId, ...context }, signal) => execute({ operation: "start", context, runId }, signal),
    read: ({ runId, ...context }, signal) => execute({ operation: "read", context, runId }, signal),
    cancel: ({ runId, ...context }, signal) => execute({ operation: "cancel", context, runId }, signal),
  };
}
