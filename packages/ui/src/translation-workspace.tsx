"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Panel, Status } from "./index";
import { parseTranslationView, translationAck, translationAttemptId, type TranscriptPage, type TranslationPort, type TranslationView } from "./translation-view";

export function TranslationWorkspace({ page, port, chooseParagraph }: { page: TranscriptPage; port: TranslationPort; chooseParagraph?: (index: number) => void }) {
  const [run, setRun] = useState<TranslationView | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [located, setLocated] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const context = { bindingId: page.context.bindingId, videoId: page.context.videoId, sourceRunId: page.sourceRunId, offset: page.offset, targetLanguage: "zh-Hans" as const };
  useEffect(() => {
    void execute("find");
    return () => { operation.current?.abort(); operation.current = null; clearTimeout(expiryTimer.current); };
    // The owning reader keys this workspace by immutable source and page, not theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function execute(kind: "find" | "read" | "start" | "cancel", predecessor?: string) {
    if (kind === "cancel") { operation.current?.abort(); operation.current = null; }
    else if (operation.current) return;
    const controller = new AbortController();
    let began = performance.now();
    clearTimeout(expiryTimer.current); setExpired(false);
    operation.current = controller; setBusy(true); setFailed(false); setRun(null);
    const timeout = setTimeout(() => controller.abort(), kind === "start" ? 95_000 : 10_000);
    try {
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Translation wait ended")), { once: true }));
      const work = async () => {
        if (kind === "find") return parseTranslationView(await port.find(context, controller.signal), page);
        const runId = predecessor !== undefined || currentId === null
          ? await translationAttemptId(page, predecessor ?? null) : currentId;
        controller.signal.throwIfAborted(); setCurrentId(runId);
        if (kind === "start" || kind === "cancel") {
          const ack = translationAck.parse(await (kind === "cancel" ? port.cancel(runId, controller.signal) : port.start({ ...context, runId }, controller.signal)));
          if (ack.runId !== runId) throw new Error("Translation changed");
          controller.signal.throwIfAborted();
        }
        began = performance.now();
        return parseTranslationView(await port.read(runId, controller.signal), page, runId);
      };
      const found = await Promise.race([work(), aborted]);
      if (operation.current !== controller) return;
      if (kind === "find") setLocated(true);
      setCurrentId(found?.runId ?? null);
      if (found?.status === "ready" && found.observedAt) {
        const deadline = began + Date.parse(found.contentExpiresAt) - Date.parse(found.observedAt);
        const check = () => {
          const remaining = deadline - performance.now();
          if (!Number.isFinite(remaining) || remaining <= 0) { setRun(null); setExpired(true); return false; }
          expiryTimer.current = setTimeout(check, Math.min(remaining, 2_147_483_647)); return true;
        };
        if (!check()) return;
      }
      setRun(found);
    } catch { if (operation.current === controller) setFailed(true); }
    finally { clearTimeout(timeout); if (operation.current === controller) { operation.current = null; setBusy(false); } }
  }
  const terminal = run && ["failed", "cancelled", "interrupted"].includes(run.status);
  const active = run?.status === "queued" || run?.status === "running";
  const runLabels = { queued: "翻译已排队", running: "翻译正在生成", ready: "译文已就绪", failed: "本次翻译未完成", cancelled: "本次翻译已取消", interrupted: "本次翻译已中断", cleared: "这份译文已清除" };
  return <section className="translation-workspace" aria-label="双语对照阅读">
    <Panel className="translation-tools"><p className="transcript-eyebrow">COMPARE / 对照</p><h3>原文 · 中文</h3>
      <p className="transcript-muted">翻译帮助理解，不代表学习进度或掌握证明。仅在你点击时生成当前页译文，可能消耗测试额度。</p>
      <div className="transcript-actions"><Button disabled={!located || busy || active || run?.status === "ready" || run?.status === "cleared" || expired} onClick={() => {
        void execute("start", terminal ? run.runId : undefined);
      }}>{busy ? "正在处理翻译…" : terminal ? "重新尝试翻译" : run?.status === "ready" ? "译文已就绪" : currentId ? "重发同一请求" : "翻译当前页"}</Button>
        <Button disabled={busy} onClick={() => void execute(currentId ? "read" : "find")}>{currentId ? "核对当前翻译" : "查找已有翻译"}</Button>
        {currentId && (!run || active) ? <Button onClick={() => void execute("cancel")}>取消当前翻译</Button> : null}</div>
      {run ? <Status tone={run.status === "ready" ? "success" : "warning"}>{runLabels[run.status]}。{active ? "可核对进度或取消，本页不会自动重试。" : ""}</Status> : null}
      <p className="transcript-muted">取消不保证撤销已发生的费用；生成中的服务可能已经接收请求。</p>
      {failed ? <Status tone="warning">结果尚未确认，旧译文已隐藏。{currentId ? "核对只读取原请求，不会重新生成；重发也使用同一个请求编号。" : "请先查找已有翻译，确认云端状态后再生成。"}</Status> : null}
      {expired ? <Status tone="warning">译文使用期限已到，旧译文已隐藏。请重新核对材料。</Status> : null}
    </Panel>
    <ol className="transcript-segments transcript-bilingual" start={page.offset + 1}>{page.segments.map((segment, index) => {
      const seconds = Math.floor(segment.offsetMs / 1000), label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      return <li key={page.offset + index}><a href={`https://www.youtube.com/watch?v=${page.context.videoId}&t=${seconds}s`} target="_blank" rel="noopener noreferrer" aria-label={`在 YouTube 打开 ${label}`}>{label} ↗</a>
        <div className="transcript-column"><span className="transcript-column-label">原文 · {page.language}</span><p data-explanation-segment={page.offset + index}>{segment.text}</p>
          {chooseParagraph ? <Button className="transcript-select" onClick={() => chooseParagraph(index)}>选择第 {page.offset + index + 1} 段讲解</Button> : null}</div>
        <div className="transcript-column transcript-chinese" lang="zh-Hans"><span className="transcript-column-label">中文 · 辅助译文</span><p>{run?.result?.status === "translated" ? run.result.segments[index]?.translation ?? "等待译文" : "等待译文"}</p></div></li>;
    })}</ol>
  </section>;
}
