"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button, Panel, Status } from "./index";
import { selectedExplanationText, explanationAttemptId, explanationAck, parseExplanationView,
  type ExplanationPort, type ExplanationSelection, type ExplanationView } from "./explanation-view";
import type { TranscriptPage } from "./translation-view";
const disabledResponse = z.strictObject({ ok: z.literal(false), code: z.literal("disabled") });

/** Session memory only; no caption or answer cache. The reader owns the source clock. */
export type ExplanationDraft = {
  sourceRunId: string; offset: number; sourceKey: string; deadline: number;
  selection: ExplanationSelection; question: string; attemptId: string | null;
};
export function explanationPageKey(page: TranscriptPage) {
  return JSON.stringify([page.ownerId, page.context.bindingId, page.context.nodeId, page.context.videoId,
    page.sourceRunId, page.offset, page.sourceBlueprintVersion, page.sourceCreatedAt, page.contentExpiresAt, page.language]);
}
export function ExplanationWorkspace({ page, draft, change, port, onOperationChange, onSourceUnavailable }: {
  page: TranscriptPage; draft: ExplanationDraft; change: (draft: ExplanationDraft | null) => void; port: ExplanationPort;
  onOperationChange: (busy: boolean) => void;
  onSourceUnavailable: (reason: "cleared" | "expired") => void;
}) {
  const [run, setRun] = useState<ExplanationView | null>(null), [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false), [expired, setExpired] = useState(false), [located, setLocated] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const operation = useRef<AbortController | null>(null), expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const context = { bindingId: page.context.bindingId, videoId: page.context.videoId, sourceRunId: page.sourceRunId,
    offset: page.offset, targetLanguage: "zh-Hans" as const, selection: draft.selection, question: draft.question };
  useEffect(() => () => { operation.current?.abort(); operation.current = null; clearTimeout(expiryTimer.current); onOperationChange(false); }, [onOperationChange]);
  async function execute(kind: "start" | "read" | "find" | "cancel" | "retry") {
    if (kind === "cancel") { operation.current?.abort(); operation.current = null; }
    else if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const predecessor = kind === "retry" ? run?.runId ?? null : null;
    const previous = run, notEnabled = {};
    let runId = kind === "retry" ? null : draft.attemptId, began = performance.now();
    setBusy(true); onOperationChange(true); setFailed(false); setDisabled(false); setRun(null); clearTimeout(expiryTimer.current);
    const timeout = setTimeout(() => controller.abort(), kind === "start" || kind === "retry" ? 95_000 : 10_000);
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Explanation wait ended")), { once: true }));
    try {
      const work = async () => {
        if (kind === "find" || kind === "start" && !runId) {
          const found = parseExplanationView(await port.find(context, controller.signal), page, context);
          controller.signal.throwIfAborted();
          if (kind === "find" || found) return found;
        }
        if (!runId) runId = await explanationAttemptId(page, context, predecessor);
        controller.signal.throwIfAborted();
        // Freeze the original request before it can reach a consuming endpoint.
        change({ ...draft, attemptId: runId });
        const input = { ...context, runId };
        if (kind === "start" || kind === "retry" || kind === "cancel") {
          const response = await (kind === "cancel" ? port.cancel(input, controller.signal) : port.start(input, controller.signal));
          controller.signal.throwIfAborted();
          if (kind !== "cancel" && disabledResponse.safeParse(response).success) throw notEnabled;
          const ack = explanationAck.parse(response);
          if (ack.runId !== runId) throw new Error("Explanation changed");
          controller.signal.throwIfAborted();
        }
        began = performance.now();
        return parseExplanationView(await port.read(input, controller.signal), page, context, runId);
      };
      const found = await Promise.race([work(), aborted]);
      if (operation.current !== controller) return;
      setLocated(true);
      if (found) {
        if (found.status === "cleared") { onSourceUnavailable("cleared"); return; }
        if (found.observedAt) {
          const deadline = Math.min(draft.deadline, began + Date.parse(found.contentExpiresAt) - Date.parse(found.observedAt));
          const check = () => {
            const remaining = deadline - performance.now();
            if (!Number.isFinite(remaining) || remaining <= 0) { setRun(null); setExpired(true); onSourceUnavailable("expired"); return false; }
            expiryTimer.current = setTimeout(check, Math.min(remaining, 2_147_483_647)); return true;
          };
          if (!check()) return;
          change({ ...draft, attemptId: found.runId, deadline });
        }
      }
      setRun(found);
    } catch (error) {
      if (operation.current === controller) {
        if (error === notEnabled) {
          setDisabled(true);
          // A disabled gate rejects before begin. Never unlock an already-uncertain
          // attempt merely because the switch was turned off after it started.
          if (!draft.attemptId || kind === "retry") { change(draft); setRun(previous); }
        } else setFailed(true);
      }
    }
    finally { clearTimeout(timeout); if (operation.current === controller) { operation.current = null; setBusy(false); onOperationChange(false); } }
  }
  const active = run?.status === "queued" || run?.status === "running";
  const terminal = run && !active;
  const retryable = run && ["failed", "cancelled", "interrupted"].includes(run.status);
  const frozen = busy || Boolean(draft.attemptId);
  const answer = run?.result && "answer" in run.result ? run.result.answer : null;
  const labels = { queued: "讲解已排队", running: "讲解正在生成", ready: "讲解已就绪", failed: "本次讲解未完成", cancelled: "本次讲解已取消", interrupted: "本次讲解已中断", cleared: "这份讲解已清除" };
  return <Panel className="explanation-workspace" aria-label="选文讲解">
    <header><p className="transcript-eyebrow">ANNOTATE / 释义</p><h3>把这一段弄明白</h3></header>
    <blockquote>{selectedExplanationText(page, draft.selection)}</blockquote>
    <label>你想弄明白什么？<textarea aria-label="讲解问题（可选）" value={draft.question} maxLength={1000} rows={3} disabled={frozen}
      placeholder="可留空，先听听这一段的意思" onChange={event => { setRun(null); setFailed(false); setLocated(false); change({ ...draft, question: event.target.value }); }} /></label>
    <p className="transcript-muted">{draft.question.length} / 1000 · 草稿仅留在当前会话；来源到期会清除。切主题不会丢失，关闭或刷新页面不保留。</p>
    <div className="transcript-actions">
      {!draft.attemptId ? <Button disabled={busy || expired} onClick={() => void execute("start")}>讲解这段原文</Button> : null}
      <Button disabled={busy || expired} onClick={() => void execute(draft.attemptId ? "read" : "find")}>{draft.attemptId ? "核对原讲解" : "查找已有讲解"}</Button>
      {failed && draft.attemptId ? <Button disabled={busy || expired} onClick={() => void execute("start")}>重发同一讲解请求</Button> : null}
      {draft.attemptId && (!run || active) ? <Button disabled={expired} onClick={() => void execute("cancel")}>取消讲解</Button> : null}
      {retryable ? <Button disabled={busy || expired} onClick={() => void execute("retry")}>重新尝试讲解</Button> : null}
      {!frozen || terminal ? <Button disabled={busy} onClick={() => change(null)}>{terminal ? "开始新的选文提问" : "收起选文"}</Button> : null}
    </div>
    <p className="transcript-muted">仅明确发起才可能消耗测试额度。核对和查找不会生成；取消不保证撤销已发生的费用。</p>
    {busy ? <Status tone="progress">正在核对讲解，离开不会自动重试。</Status> : null}
    {run ? <Status tone={run.status === "ready" ? "success" : "warning"}>{labels[run.status]}。{active ? "可核对或取消，不会自动轮询生成。" : ""}</Status> : null}
    {located && !run && !failed && !busy && !expired ? <Status>没有找到对应讲解；需要你明确发起。</Status> : null}
    {failed ? <Status tone="warning">结果尚未确认，旧答案已隐藏。{draft.attemptId ? "先核对原讲解；重发保留同一编号，不自动新增请求。" : "草稿仍在，可重新查找。"}</Status> : null}
    {disabled ? <Status tone="warning">讲解暂未开启，本次发起未进入生成。{draft.attemptId ? "此前请求仍需核对，关闭开关不代表它没有执行。" : "草稿可继续编辑，也可查找已有讲解。"}</Status> : null}
    {expired ? <Status tone="warning">来源期限已到，旧答案已隐藏，请重新核对材料。</Status> : null}
    {answer ? <section className="explanation-answer" aria-label="讲解结果">
      {answer.kind === "insufficient_context" ? <><h4>还需要一些上下文</h4><p>{answer.reason}</p><ul>{answer.missingContext.map((text, index) => <li key={index}>{text}</li>)}</ul></> : <>
        <section><h4>原文意思</h4><p>{answer.meaning}</p></section>
        <section><h4>依据与解释</h4><p>{answer.reasoning}</p><ul className="explanation-evidence">{answer.evidence.map((evidence, index) => {
          const segment = page.segments[evidence.segmentIndex - page.offset]!;
          const seconds = Math.floor(segment.offsetMs / 1000);
          return <li key={index}><q>{evidence.quote}</q><a href={`https://www.youtube.com/watch?v=${page.context.videoId}&t=${seconds}s`} target="_blank" rel="noopener noreferrer">第 {evidence.segmentIndex + 1} 段 · 回看原文 ↗</a></li>;
        })}</ul></section>
        {answer.background ? <section className="explanation-background"><h4>一般背景 · 非原文事实</h4><p>{answer.background}</p></section> : null}
        {answer.checkQuestion ? <section><h4>试着回答自己</h4><p>{answer.checkQuestion}</p></section> : null}
        {answer.limitations.length ? <section><h4>这份解释的局限</h4><ul>{answer.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul></section> : null}
      </>}
      <p className="transcript-muted">引用对应原文不等于解释一定正确；讲解不是学习进度或掌握证明。</p>
    </section> : null}
  </Panel>;
}
