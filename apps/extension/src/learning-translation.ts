import { browser } from "wxt/browser";
import { parseTranslationView, translationAck, translationCommand, translationResponse } from "@blueprint/ui/translation-view";
import type { createExtensionAuthPort } from "./auth";
import { createAuthenticatedTransport } from "./authenticated-transport";
import { createLearningTranscriptReader } from "./learning-transcript";

type Sender = { id?: string; url?: string; tab?: { url?: string } };
type Selection = { expectedTabId?: unknown; nodeId?: unknown };
const unavailable = { ok: false, code: "unavailable" } as const;

/** Sidepanel-only translation; source reads authorize the selected node, never call a provider. */
export function createLearningTranslationTransport(auth: ReturnType<typeof createExtensionAuthPort>, apiBase: string) {
  const { authorize } = createAuthenticatedTransport(auth, apiBase);
  const readSource = createLearningTranscriptReader(auth, apiBase);
  return async (ownerId: unknown, input: unknown, selection: Selection, sender?: Sender): Promise<unknown> => {
    try {
      const panel = browser.runtime.getURL("/sidepanel.html");
      if (!sender || sender.id !== browser.runtime.id || sender.url !== panel || sender.tab !== undefined && sender.tab.url !== panel)
        return { ok: false, code: "forbidden" };
      const parsed = translationCommand.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const command = parsed.data, context = command.context;
      const controller = new AbortController(), signal = controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<unknown>(resolve => { timer = setTimeout(() => {
        controller.abort(); resolve(unavailable);
      }, command.operation === "start" ? 95_000 : 10_000); });
      const work = async () => {
        const identity = await authorize(ownerId);
        if (!identity.ok) return identity;
        const source = await readSource(ownerId, { bindingId: context.bindingId, videoId: context.videoId,
          sourceRunId: context.sourceRunId, offset: context.offset }, selection, sender);
        if (!source.ok) return source;
        if (command.operation === "start" && source.value.status !== "ready") return unavailable;
        signal.throwIfAborted();
        if (!await auth.isCurrent(identity.value.token)) return { ok: false, code: "forbidden" };
        const base = `${apiBase}/api/v1/translations/runs`;
        const accountId = identity.value.session.userId;
        const runId = "runId" in command ? command.runId : undefined;
        const exchange = async (operation: typeof command.operation) => {
          signal.throwIfAborted();
          const path = operation === "find" ? `${base}?${new URLSearchParams({ accountId, ...context, offset: String(context.offset) })}`
            : operation === "start" ? base : `${base}/${runId}${operation === "read" ? `?${new URLSearchParams({ accountId })}` : ""}`;
          const body = operation === "start" ? { accountId, ...context, runId }
            : operation === "cancel" ? { accountId, operation: "cancel" } : undefined;
          const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store", redirect: "error", signal,
            headers: { Authorization: `Bearer ${identity.value.token}`, "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          if (response.headers.get("content-type")?.split(";")[0] !== "application/json") {
            void response.body?.cancel().catch(() => undefined); return unavailable;
          }
          const reader = response.body?.getReader();
          if (!reader) return unavailable;
          const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0;
          try {
            while (true) {
              const part = await reader.read(); if (part.done) break;
              size += part.value.byteLength; if (size > 2 * 1024 * 1024) throw new Error("Translation response too large");
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
          signal.throwIfAborted();
          if (!await auth.isCurrent(identity.value.token)) return { ok: false, code: "forbidden" };
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          const selected = (raw?: string) => {
            try { const url = new URL(raw ?? ""); return url.origin === "https://www.youtube.com" && url.pathname === "/watch"
              && url.searchParams.getAll("v").length === 1 && url.searchParams.get("v") === context.videoId; } catch { return false; }
        };
        if (tab?.id !== selection.expectedTabId || !selected(tab?.url) || tab?.pendingUrl && !selected(tab.pendingUrl)) return unavailable;
        const value: unknown = JSON.parse(text);
        if (response.status === 401 && typeof value === "object" && value !== null && "code" in value && value.code === "unauthenticated") {
          await auth.invalidate(identity.value.token); return { ok: false, code: "unauthenticated" };
        }
        if (!response.ok) return unavailable;
        if (operation === "start" || operation === "cancel") {
          const ack = translationAck.parse(value);
          return ack.runId === runId ? ack : unavailable;
        }
        const result = translationResponse.parse(value), run = result.run;
        if (!run) return operation === "find" ? result : unavailable;
        if (run.accountId !== accountId || operation === "read" && run.runId !== runId
          || run.context.bindingId !== context.bindingId || run.context.videoId !== context.videoId
          || run.context.sourceRunId !== context.sourceRunId || run.context.offset !== context.offset) return unavailable;
        if (source.value.status === "ready") parseTranslationView(result, source.value, operation === "read" ? runId : undefined);
        else if (run.result?.status === "translated") return unavailable;
        return result;
      };
      if (command.operation === "cancel") {
        // A valid selected page does not authorize cancelling another page's run.
        const target = await exchange("read");
        if (!target.ok) return target;
        if (!("run" in target) || !target.run) return unavailable;
      }
      return exchange(command.operation);
      };
      try { return await Promise.race([work(), deadline]); }
      finally { clearTimeout(timer); controller.abort(); }
    } catch { return unavailable; }
  };
}
