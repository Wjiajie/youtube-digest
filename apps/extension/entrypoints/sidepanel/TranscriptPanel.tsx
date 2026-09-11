import { browser } from "wxt/browser";
import { useMemo } from "react";
import type { ApplicationResult, LearningTranscript } from "@blueprint/domain";
import { Panel, Status } from "@blueprint/ui";
import { LearningTranscriptReader, type TranslationPort } from "@blueprint/ui/learning-transcript";
import type { TranslationContext } from "@blueprint/ui/translation-view";
import "@blueprint/ui/learning-transcript.css";

type Context = { nodeId: string; resourceBindingId: string; videoId: string };
function translationPort(ownerId: string, expectedTabId: number, nodeId: string): TranslationPort {
  let context: TranslationContext | undefined;
  async function send(operation: "find" | "start" | "read" | "cancel", signal: AbortSignal, runId?: string) {
    signal.throwIfAborted();
    if (!context) throw new Error("Read a source page before translating");
    const result: unknown = await browser.runtime.sendMessage({ type: "LEARNING_TRANSLATION", ownerId, expectedTabId, nodeId,
      input: { operation, context: { ...context }, ...(runId === undefined ? {} : { runId }) } });
    signal.throwIfAborted();
    return result;
  }
  return {
    find: (input, signal) => { context = { ...input }; return send("find", signal); },
    start: (input, signal) => { const { runId, ...page } = input; context = page; return send("start", signal, runId); },
    read: (runId, signal) => send("read", signal, runId),
    cancel: (runId, signal) => send("cancel", signal, runId),
  };
}
export function TranscriptPanel({ ownerId, expectedTabId, context }: { ownerId: string; expectedTabId?: number; context?: Context }) {
  const translation = useMemo(() => context && expectedTabId !== undefined ? translationPort(ownerId, expectedTabId, context.nodeId) : undefined,
    [ownerId, expectedTabId, context?.nodeId, context?.resourceBindingId, context?.videoId]);
  if (!context || expectedTabId === undefined) return <Panel><h2>理解当前视频</h2>
    <Status tone="neutral">请先打开已绑定的 YouTube 视频并选择本次学习节点，再明确读取原始字幕。不会自动获取材料。</Status></Panel>;
  return <LearningTranscriptReader key={`${ownerId}:${expectedTabId}:${context.nodeId}:${context.resourceBindingId}:${context.videoId}`}
    accountId={ownerId} bindingId={context.resourceBindingId} videoId={context.videoId}
    translation={translation}
    loadAction={async input => {
      try {
        const result = await browser.runtime.sendMessage({ type: "LOAD_LEARNING_TRANSCRIPT", ownerId, expectedTabId, nodeId: context.nodeId, input }) as ApplicationResult<LearningTranscript>;
        if (result.ok && result.value.context.nodeId !== context.nodeId) return { ok: false, code: "unavailable" };
        return result;
      } catch { return { ok: false, code: "unavailable" }; }
    }} />;
}
