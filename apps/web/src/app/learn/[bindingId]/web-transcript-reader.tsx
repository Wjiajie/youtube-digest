"use client";
import { useMemo } from "react";
import type { ApplicationResult, LearningTranscript, LearningTranscriptRequest } from "@blueprint/domain";
import { LearningTranscriptReader, type TranslationPort } from "@blueprint/ui/learning-transcript";

/** This adapter carries only same-origin Cookie Auth, never provider or worker credentials. */
function translationPort(accountId: string): TranslationPort {
  const base = "/api/translations/runs";
  async function request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      cache: "no-store", redirect: "error", signal,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/json") throw new Error("Translation response unavailable");
    // Bound receipt bytes before JSON parsing. The shared reader owns the finite wait and strict projection parsing.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Translation response unavailable");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let size = 0, text = "";
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error("Translation response too large");
        text += decoder.decode(part.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  return {
    find: (input, signal) => request(`${base}?${new URLSearchParams({ accountId, ...input, offset: String(input.offset) })}`, signal),
    start: (input, signal) => request(base, signal, { accountId, ...input }),
    read: (runId, signal) => request(`${base}/${encodeURIComponent(runId)}?${new URLSearchParams({ accountId })}`, signal),
    cancel: (runId, signal) => request(`${base}/${encodeURIComponent(runId)}`, signal, { accountId, operation: "cancel" }),
  };
}

export function WebTranscriptReader(props: { accountId: string; bindingId: string; videoId: string;
  loadAction: (input: LearningTranscriptRequest) => Promise<ApplicationResult<LearningTranscript>> }) {
  const translation = useMemo(() => translationPort(props.accountId), [props.accountId]);
  return <LearningTranscriptReader {...props} translation={translation} />;
}
