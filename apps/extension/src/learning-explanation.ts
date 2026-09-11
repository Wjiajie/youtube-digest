import { browser } from "wxt/browser";
import { explanationAck, explanationCommand, explanationResponse, parseExplanationView, selectedExplanationText } from "@blueprint/ui/explanation-view";
import type { createExtensionAuthPort } from "./auth";
import { createAuthenticatedTransport } from "./authenticated-transport";
import { createLearningTranscriptReader } from "./learning-transcript";

type Sender = { id?: string; url?: string; tab?: { url?: string } };
type Selection = { expectedTabId?: unknown; nodeId?: unknown };
const unavailable = { ok: false, code: "unavailable" } as const;

/** The sidepanel's source-bound explanation adapter never queues or stores content. */
export function createLearningExplanationTransport(auth: ReturnType<typeof createExtensionAuthPort>, apiBase: string) {
  const { authorize } = createAuthenticatedTransport(auth, apiBase);
  const readSource = createLearningTranscriptReader(auth, apiBase);
  return async (ownerId: unknown, input: unknown, selection: Selection, sender?: Sender): Promise<unknown> => {
    try {
      const panel = browser.runtime.getURL("/sidepanel.html");
      if (!sender || sender.id !== browser.runtime.id || sender.url !== panel || sender.tab !== undefined && sender.tab.url !== panel)
        return { ok: false, code: "forbidden" };
      const parsed = explanationCommand.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const command = parsed.data, context = command.context;
      const controller = new AbortController(), signal = controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<unknown>(resolve => { timer = setTimeout(() => {
        controller.abort(); resolve(unavailable);
      }, command.operation === "start" ? 95_000 : 10_000); });
      const work = async () => {
        const identity = await authorize(ownerId);
        signal.throwIfAborted();
        if (!identity.ok) return identity;
        const sourceInput = { bindingId: context.bindingId, videoId: context.videoId, sourceRunId: context.sourceRunId, offset: context.offset };
        const sourceStartedAt = performance.now();
        const source = await readSource(ownerId, sourceInput, selection, sender);
        signal.throwIfAborted();
        if (!source.ok) return source;
        const sourcePage = source.value;
        const sourceDeadline = sourcePage.status === "ready"
          ? sourceStartedAt + Date.parse(sourcePage.contentExpiresAt) - Date.parse(sourcePage.observedAt) : 0;
        if (sourcePage.status === "ready") {
          if (performance.now() >= sourceDeadline) return unavailable;
          selectedExplanationText(sourcePage, context.selection);
        }
        if (command.operation === "start" && sourcePage.status !== "ready") return unavailable;
        const accountId = identity.value.session.userId;
        const runId = "runId" in command ? command.runId : undefined;
        const base = `${apiBase}/api/v1/explanations/runs`;
        const current = async () => {
          signal.throwIfAborted();
          if (!await auth.isCurrent(identity.value.token)) return { ok: false, code: "forbidden" } as const;
          signal.throwIfAborted();
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          signal.throwIfAborted();
          const selected = (raw?: string) => {
            try { const url = new URL(raw ?? ""); return url.origin === "https://www.youtube.com" && url.pathname === "/watch"
              && url.searchParams.getAll("v").length === 1 && url.searchParams.get("v") === context.videoId; } catch { return false; }
          };
          if (tab?.id !== selection.expectedTabId || !selected(tab?.url) || tab?.pendingUrl && !selected(tab.pendingUrl)) return unavailable;
          if (!await auth.isCurrent(identity.value.token)) return { ok: false, code: "forbidden" } as const;
          signal.throwIfAborted();
          return { ok: true } as const;
        };
        const exchange = async (operation: typeof command.operation) => {
          const before = await current(); if (!before.ok) return before;
          const path = operation === "find" ? `${base}/find` : operation === "start" ? base
            : `${base}/${runId}${operation === "read" ? `?${new URLSearchParams({ accountId })}` : ""}`;
          const body = operation === "find" ? { accountId, ...context }
            : operation === "start" ? { accountId, ...context, runId }
            : operation === "cancel" ? { accountId, operation: "cancel" } : undefined;
          const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store", redirect: "error", signal,
            headers: { Authorization: `Bearer ${identity.value.token}`, "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          if (response.headers.get("content-type")?.split(";")[0] !== "application/json") {
            void response.body?.cancel().catch(() => undefined); return unavailable;
          }
          const reader = response.body?.getReader(); if (!reader) return unavailable;
          const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0;
          try {
            while (true) {
              signal.throwIfAborted();
              const part = await reader.read(); if (part.done) break;
              size += part.value.byteLength; if (size > 2 * 1024 * 1024) throw new Error("Explanation response too large");
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
          const after = await current(); if (!after.ok) return after;
          const value: unknown = JSON.parse(text);
          if (response.status === 401 && typeof value === "object" && value !== null && "code" in value && value.code === "unauthenticated") {
            await auth.invalidate(identity.value.token); return { ok: false, code: "unauthenticated" } as const;
          }
          // Only the start gate's exact response proves that no attempt began.
          if (operation === "start" && response.status === 503 && typeof value === "object" && value !== null
            && Object.keys(value).length === 2 && "ok" in value && value.ok === false && "code" in value && value.code === "disabled")
            return { ok: false, code: "disabled" } as const;
          if (!response.ok) return unavailable;
          if (operation === "start" || operation === "cancel") {
            const ack = explanationAck.parse(value); return ack.runId === runId ? ack : unavailable;
          }
          const result = explanationResponse.parse(value), run = result.run;
          if (!run) return operation === "find" ? result : unavailable;
          if (run.accountId !== accountId || operation === "read" && run.runId !== runId
            || run.context.bindingId !== context.bindingId || run.context.videoId !== context.videoId
            || run.context.sourceRunId !== context.sourceRunId || run.context.offset !== context.offset) return unavailable;
          if (run.status === "cleared" && (run.selection !== null || run.question !== null || run.result !== null || run.observedAt !== null)) return unavailable;
          if (run.status !== "cleared") {
            if (sourcePage.status !== "ready" || performance.now() >= sourceDeadline) return unavailable;
            parseExplanationView(result, sourcePage, context, operation === "read" ? runId : undefined);
          }
          return result;
        };
        if (command.operation === "cancel") {
          // A source page alone cannot authorize cancelling a different question's run.
          const target = await exchange("read");
          if (!target.ok || !("run" in target) || !target.run) return target.ok ? unavailable : target;
          if (target.run.status === "cleared") return { ok: true, runId: target.run.runId, status: "cleared" };
        }
        const result = await exchange(command.operation);
        if (!result.ok) return result;
        signal.throwIfAborted();
        const fresh = await readSource(ownerId, sourceInput, selection, sender);
        signal.throwIfAborted();
        const after = await current(); if (!after.ok) return after;
        if (!fresh.ok) return fresh;
        if ("run" in result && result.run?.status === "cleared") return result;
        if (sourcePage.status !== "ready" || fresh.value.status !== "ready" || performance.now() >= sourceDeadline) return unavailable;
        const { observedAt: _firstObserved, ...first } = sourcePage;
        const { observedAt: _lastObserved, ...last } = fresh.value;
        if (JSON.stringify(first) !== JSON.stringify(last)) return unavailable;
        if ("run" in result) parseExplanationView(result, fresh.value, context, command.operation === "read" ? runId : undefined);
        return result;
      };
      try { return await Promise.race([work(), deadline]); }
      finally { clearTimeout(timer); controller.abort(); }
    } catch { return unavailable; }
  };
}
