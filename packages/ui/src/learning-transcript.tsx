"use client";
import { useEffect, useRef, useState } from "react";
import { parseLearningTranscript, type ApplicationResult, type LearningTranscript, type LearningTranscriptRequest } from "@blueprint/domain";
import { Button, Panel, Status } from "./index";
import { TranslationWorkspace } from "./translation-workspace";
import type { TranslationPort } from "./translation-view";
import { ExplanationWorkspace, explanationPageKey, type ExplanationDraft } from "./explanation-workspace";
import { selectedExplanationText, type ExplanationPort, type ExplanationSelection } from "./explanation-view";
export type { TranslationPort } from "./translation-view";
export type { ExplanationPort } from "./explanation-view";

type Props = { accountId: string; bindingId: string; videoId: string;
  translation?: TranslationPort;
  explanation?: ExplanationPort;
  loadAction: (input: LearningTranscriptRequest) => Promise<ApplicationResult<LearningTranscript>> };
const unavailableLabels = { not_acquired: "尚无可阅读的原始字幕。", pending: "原始字幕仍在处理，本次读取不会启动或轮询提供方。",
  not_available: "当前材料没有可阅读的原始字幕。", expired: "字幕使用期限已到，旧材料已隐藏。", cleared: "这份字幕材料已清除。" };

export function LearningTranscriptReader(props: Props) {
  return <BoundTranscript key={`${props.accountId}:${props.bindingId}:${props.videoId}`} {...props} />;
}
function BoundTranscript({ accountId, bindingId, videoId, loadAction, translation, explanation }: Props) {
  const [page, setPage] = useState<LearningTranscript | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<"expired" | "recheck" | "cleared" | null>(null);
  const generation = useRef(0), started = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const command = useRef<LearningTranscriptRequest>({ bindingId, videoId, sourceRunId: null, offset: 0 });
  const [draft, setDraft] = useState<ExplanationDraft | null>(null), [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [explanationBusy, setExplanationBusy] = useState(false);
  const pageDeadline = useRef(0);
  const explanationAnchor = useRef<HTMLDivElement | null>(null), focusExplanation = useRef(false);
  useEffect(() => { if (focusExplanation.current && explanationAnchor.current) { focusExplanation.current = false; explanationAnchor.current.focus(); } }, [draft]);
  useEffect(() => {
    if (!draft) return;
    const expiry = setTimeout(() => setDraft(null), Math.max(0, Math.min(draft.deadline - performance.now(), 2_147_483_647)));
    return () => clearTimeout(expiry);
  }, [draft?.deadline]);
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
          pageDeadline.current = deadline;
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
  function select(selection: ExplanationSelection, focus = false) {
    if (!explanation || page?.status !== "ready") return;
    if (explanationBusy || draft?.attemptId) { setSelectionNotice("请先核对原讲解，再开始新的选文提问。"); return; }
    try {
      selectedExplanationText(page, selection);
      focusExplanation.current = focus;
      setDraft({ sourceRunId: page.sourceRunId, offset: page.offset, sourceKey: explanationPageKey(page), deadline: pageDeadline.current,
        selection, question: draft?.question ?? "", attemptId: null });
      setSelectionNotice(null);
    } catch { setSelectionNotice("请选择同页原文中不超过 5 段、2000 字符的连续文字，不要拆开 emoji。"); }
  }
  const chooseParagraph = explanation && page?.status === "ready" ? (index: number) => select({
    start: { segmentIndex: page.offset + index, charOffset: 0 }, end: { segmentIndex: page.offset + index, charOffset: page.segments[index]!.text.length },
  }, true) : undefined;
  function captureSelection(root: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    function point(node: Node, offset: number) {
      const element = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-explanation-segment]");
      if (!element || !root.contains(element)) return null;
      const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(node, offset);
      return { segmentIndex: Number(element.dataset.explanationSegment), charOffset: prefix.toString().length };
    }
    const start = point(range.startContainer, range.startOffset), end = point(range.endContainer, range.endOffset);
    if (start && end) select({ start, end });
  }
  return <section className="transcript-reader" aria-label="原始字幕阅读"
    onPointerUp={event => captureSelection(event.currentTarget)} onKeyUp={event => { if (event.shiftKey) captureSelection(event.currentTarget); }}>
    <Panel className="transcript-heading"><p className="transcript-eyebrow">UNDERSTAND / 理解</p><h2>原始字幕</h2>
      <p className="transcript-muted">只读取已获取原文，不启动新任务或扣次。无字幕也可继续记录。</p>
      <div className="transcript-actions"><Button disabled={busy} onClick={() => void read()}>{busy ? "正在读取字幕…" : started.current ? "重新读取字幕" : "读取原始字幕"}</Button>
        {command.current.sourceRunId ? <Button disabled={busy} onClick={() => void read({ bindingId, videoId, sourceRunId: null, offset: 0 })}>查找最新字幕</Button> : null}</div>
    </Panel>
    {notice ? <Status tone="warning">{notice === "expired" ? "字幕使用期限已到，旧材料已隐藏。" : notice === "cleared" ? "讲解内容已清除，旧材料与问题已隐藏，请重新核对字幕。" : "返回工作台后需要重新核对字幕，旧材料已隐藏。"} 不会自动获取新材料。</Status> : null}
    {failed ? <Status tone="warning">暂时无法核对字幕，旧材料已隐藏。请重新读取，学习记录不受影响。</Status> : null}
    {page?.status === "unavailable" ? <Status tone="warning">{unavailableLabels[page.reason]}</Status> : null}
    {page?.status === "ready" ? <>
      <header className="transcript-source"><p>{page.context.goalTitle} / {page.context.nodeTitle}</p><h3>{page.title}</h3>
        <p className="transcript-muted">原始语言 {page.language} · 历史获取材料</p>
        <details className="transcript-provenance"><summary>来源与使用说明</summary><p>来源路径版本 {page.sourceBlueprintVersion} · 记录于 <time dateTime={page.sourceCreatedAt}>{new Date(page.sourceCreatedAt).toLocaleString("zh-CN")}</time>。不代表当前推荐或掌握证明。</p>
          <p>材料到期会自动隐藏。时间链接在新标签页打开 YouTube，不自动播放或保存进度；{translation || explanation ? `${translation && explanation ? "翻译与讲解" : translation ? "翻译" : "讲解"}需要明确点击，原文读取不会启动生成。` : "本页不生成翻译或讲解。"}</p></details>
      </header>
      <nav className="transcript-pagination" aria-label="字幕分页">
        <Button disabled={busy || page.offset === 0} onClick={() => void read({ ...command.current, offset: Math.max(0, page.offset - 20) })}>上一页</Button>
        <p role="status">{page.segments.length ? `第 ${page.offset + 1}–${page.offset + page.segments.length} 段 / 共 ${page.totalSegments} 段` : "此页没有字幕段落"}</p>
        <Button disabled={busy || page.offset + page.segments.length >= page.totalSegments} onClick={() => void read({ ...command.current, offset: page.offset + 20 })}>下一页</Button>
      </nav>
      {explanation ? <p className="transcript-muted">选中原文后查看选文与问题，或使用每段的选择按钮。最多同页 5 段、2000 字符；选中本身不会生成讲解。</p> : null}
      {selectionNotice ? <Status tone="warning">{selectionNotice}</Status> : null}
      {draft && draft.sourceKey !== explanationPageKey(page) ? <Status tone="warning">这页不是讲解草稿的来源。<Button disabled={busy} onClick={() => void read({ bindingId, videoId, sourceRunId: draft.sourceRunId, offset: draft.offset })}>返回讲解草稿</Button></Status> : null}
      {draft && explanation && draft.sourceKey === explanationPageKey(page) ? <div className="explanation-anchor" ref={explanationAnchor} tabIndex={-1}><ExplanationWorkspace key={`${draft.sourceRunId}:${draft.offset}`}
        page={page} draft={draft} change={setDraft} port={explanation} onOperationChange={setExplanationBusy}
        onSourceUnavailable={reason => { ++generation.current; clearTimeout(timer.current); setPage(null); setDraft(null); setNotice(reason); }} /></div> : null}
      {translation && page.segments.length ? <TranslationWorkspace key={`${page.sourceRunId}:${page.offset}`} page={page} port={translation} chooseParagraph={chooseParagraph} /> : <ol className="transcript-segments" start={page.offset + 1}>{page.segments.map((segment, index) => {
        const seconds = Math.floor(segment.offsetMs / 1000);
        const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        return <li key={page.offset + index}><a href={`https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`} target="_blank" rel="noopener noreferrer" aria-label={`在 YouTube 打开 ${label}`}>{label} ↗</a><div className="transcript-column"><p data-explanation-segment={page.offset + index}>{segment.text}</p>
          {chooseParagraph ? <Button className="transcript-select" onClick={() => chooseParagraph(index)}>选择第 {page.offset + index + 1} 段讲解</Button> : null}</div></li>;
      })}</ol>}
    </> : null}
  </section>;
}
