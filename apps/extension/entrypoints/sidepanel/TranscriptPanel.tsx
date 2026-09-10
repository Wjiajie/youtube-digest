import { browser } from "wxt/browser";
import type { ApplicationResult, LearningTranscript } from "@blueprint/domain";
import { Panel, Status } from "@blueprint/ui";
import { LearningTranscriptReader } from "@blueprint/ui/learning-transcript";
import "@blueprint/ui/learning-transcript.css";

type Context = { nodeId: string; resourceBindingId: string; videoId: string };
export function TranscriptPanel({ ownerId, expectedTabId, context }: { ownerId: string; expectedTabId?: number; context?: Context }) {
  if (!context || expectedTabId === undefined) return <Panel><h2>理解当前视频</h2>
    <Status tone="neutral">请先打开已绑定的 YouTube 视频并选择本次学习节点，再明确读取原始字幕。不会自动获取材料。</Status></Panel>;
  return <LearningTranscriptReader key={`${ownerId}:${expectedTabId}:${context.nodeId}:${context.resourceBindingId}:${context.videoId}`}
    accountId={ownerId} bindingId={context.resourceBindingId} videoId={context.videoId}
    loadAction={async input => {
      try {
        const result = await browser.runtime.sendMessage({ type: "LOAD_LEARNING_TRANSCRIPT", ownerId, expectedTabId, nodeId: context.nodeId, input }) as ApplicationResult<LearningTranscript>;
        if (result.ok && result.value.context.nodeId !== context.nodeId) return { ok: false, code: "unavailable" };
        return result;
      } catch { return { ok: false, code: "unavailable" }; }
    }} />;
}
