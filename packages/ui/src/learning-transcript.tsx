"use client";
import { useEffect, useRef, useState } from "react";
import { parseLearningTranscript, type ApplicationResult, type LearningTranscript, type LearningTranscriptRequest } from "@blueprint/domain";
import { Button, Panel, Status } from "./index";
import { TranslationWorkspace } from "./translation-workspace";
import type { TranslationPort } from "./translation-view";
export type { TranslationPort } from "./translation-view";

type Props = { accountId: string; bindingId: string; videoId: string;
  translation?: TranslationPort;
  loadAction: (input: LearningTranscriptRequest) => Promise<ApplicationResult<LearningTranscript>> };
const unavailableLabels = { not_acquired: "尚无可阅读的原始字幕。", pending: "原始字幕仍在处理，本次读取不会启动或轮询提供方。",
  not_available: "当前材料没有可阅读的原始字幕。", expired: "字幕使用期限已到，旧材料已隐藏。", cleared: "这份字幕材料已清除。" };

export function LearningTranscriptReader(props: Props) {
  return <BoundTranscript key={`${props.accountId}:${props.bindingId}:${props.videoId}`} {...props} />;
}
function BoundTranscript({ accountId, bindingId, videoId, loadAction, translation }: Props) {
  const [page, setPage] = useState<LearningTranscript | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<"expired" | "recheck" | null>(null);
  const generation = useRef(0), started = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const command = useRef<LearningTranscriptRequest>({ bindingId, videoId, sourceRunId: null, offset: 0 });
  useEffect(() => {
    const invalidate = () => {
      if (!started.current) return;
      ++generation.current; clearTimeout(timer.current); setPage(null); setBusy(false); setFailed(false); setNotice("recheck");
    };
    const visible = () => { if (document.visibilityState === "visible") invalidate(); };
    window.addEventListener("focus", invalidate); window.addEventListener("pageshow", invalidate); document.addEventListener("visibilitychange", visible);
    return () => {
      ++generation.current; clearTimeout(timer.current); window.removeEventListener("focus", invalidate);
      window.removeEventListener("pageshow", invalidate); document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  async function read(input = command.current) {
    command.current = input; started.current = true;
    const request = ++generation.current, began = performance.now();
    clearTimeout(timer.current); setPage(null); setBusy(true); setFailed(false); setNotice(null);
    try {
      const result = await loadAction(input);
      if (request !== generation.current) return;
      if (!result.ok) setFailed(true);
      else {
        const value = parseLearningTranscript(result.value, accountId, input);
        if (value.status === "ready") {
          command.current = { ...input, sourceRunId: value.sourceRunId };
          // DB remaining lifetime minus the complete read roundtrip; no cross-clock Date.now comparison.
          const deadline = began + Date.parse(value.contentExpiresAt) - Date.parse(value.observedAt);
          const check = () => {
            const remaining = deadline - performance.now();
            if (!Number.isFinite(remaining) || remaining <= 0) { setPage(null); setNotice("expired"); return false; }
            timer.current = setTimeout(check, Math.min(remaining, 2_147_483_647)); return true;
          };
          if (!check()) return;
        }
        setPage(value);
      }
    } catch { if (request === generation.current) setFailed(true); }
    finally { if (request === generation.current) setBusy(false); }
  }
  return <section className="transcript-reader" aria-label="原始字幕阅读">
    <Panel className="transcript-heading"><p className="transcript-eyebrow">UNDERSTAND / 理解</p><h2>原始字幕</h2>
      <p className="transcript-muted">只读取已获取原文，不启动新任务或扣次。无字幕也可继续记录。</p>
      <div className="transcript-actions"><Button disabled={busy} onClick={() => void read()}>{busy ? "正在读取字幕…" : started.current ? "重新读取字幕" : "读取原始字幕"}</Button>
        {command.current.sourceRunId ? <Button disabled={busy} onClick={() => void read({ bindingId, videoId, sourceRunId: null, offset: 0 })}>查找最新字幕</Button> : null}</div>
    </Panel>
    {notice ? <Status tone="warning">{notice === "expired" ? "字幕使用期限已到，旧材料已隐藏。" : "返回工作台后需要重新核对字幕，旧材料已隐藏。"} 不会自动获取新材料。</Status> : null}
    {failed ? <Status tone="warning">暂时无法核对字幕，旧材料已隐藏。请重新读取，学习记录不受影响。</Status> : null}
    {page?.status === "unavailable" ? <Status tone="warning">{unavailableLabels[page.reason]}</Status> : null}
    {page?.status === "ready" ? <>
      <header className="transcript-source"><p>{page.context.goalTitle} / {page.context.nodeTitle}</p><h3>{page.title}</h3>
        <p className="transcript-muted">原始语言 {page.language} · 历史获取材料</p>
        <details className="transcript-provenance"><summary>来源与使用说明</summary><p>来源路径版本 {page.sourceBlueprintVersion} · 记录于 <time dateTime={page.sourceCreatedAt}>{new Date(page.sourceCreatedAt).toLocaleString("zh-CN")}</time>。不代表当前推荐或掌握证明。</p>
          <p>材料到期会自动隐藏。时间链接在新标签页打开 YouTube，不自动播放或保存进度；{translation ? "翻译需要明确点击，原文读取不会启动翻译。" : "本页不生成翻译或讲解。"}</p></details>
      </header>
      <nav className="transcript-pagination" aria-label="字幕分页">
        <Button disabled={busy || page.offset === 0} onClick={() => void read({ ...command.current, offset: Math.max(0, page.offset - 20) })}>上一页</Button>
        <p role="status">{page.segments.length ? `第 ${page.offset + 1}–${page.offset + page.segments.length} 段 / 共 ${page.totalSegments} 段` : "此页没有字幕段落"}</p>
        <Button disabled={busy || page.offset + page.segments.length >= page.totalSegments} onClick={() => void read({ ...command.current, offset: page.offset + 20 })}>下一页</Button>
      </nav>
      {translation && page.segments.length ? <TranslationWorkspace key={`${page.sourceRunId}:${page.offset}`} page={page} port={translation} /> : <ol className="transcript-segments" start={page.offset + 1}>{page.segments.map((segment, index) => {
        const seconds = Math.floor(segment.offsetMs / 1000);
        const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        return <li key={page.offset + index}><a href={`https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`} target="_blank" rel="noopener noreferrer" aria-label={`在 YouTube 打开 ${label}`}>{label} ↗</a><p>{segment.text}</p></li>;
      })}</ol>}
    </> : null}
  </section>;
}
