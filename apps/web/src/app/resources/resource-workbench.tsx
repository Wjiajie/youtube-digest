"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";
import type { ResourceCandidateView, ResourceNodeView, ResourceRunReviewProps, ResourceUiCommand, ResourceUiResult, ResourceRunView } from "./resource-view";
import "./resource-workbench.css";
import { AdoptionStart } from "./adoption-review";
import { ClearedEvidence } from "./cleared-evidence";
import { EvidenceDeadlineNotice, useEvidenceDeadline } from "./evidence-deadline";

const kindLabels = { discover: "视频检索", captions: "字幕核对", match: "匹配建议" };
const dateLabel = (value: string) => `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
const statusLabels = { queued: "等待执行", running: "正在处理", ready: "结果已保存", stale: "来源已变化", cancelled: "已取消", interrupted: "执行已中断", failed: "本次未完成", cleared: "资源证据已清除" };
const errorLabels: Record<string, string> = { disabled: "资源服务暂未启用。", quota_exhausted: "本类操作次数不足。", busy: "已有资源操作正在处理，请核对运行记录。",
  version_conflict: "蓝图版本已变化，请返回路径核对。", invalid: "检索条件未通过检查，请核对输入。", not_found: "没有找到可访问的来源，请核对账号与路径。",
  input_too_large: "本次材料超出处理容量。", cancelled: "请求已取消，请核对记录。", unavailable: "服务暂时不可用。", retention_unavailable: "证据保留策略尚未配置或证据期限已失效，不能执行本次操作。" };
type Attempt = { id: string; state: "pending" | "unknown" | "saved"; message: string };
function useResourceAttempt(accountId: string, hideIdentity: () => void) {
  const [attempt, setAttempt] = useState<Attempt | null>(null), locked = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(command: ResourceUiCommand) {
    if (locked.current) return;
    locked.current = true;
    setAttempt({ id: command.runId, state: "pending", message: "正在提交。运行记录可能尚未创建，请勿重复发起。" });
    try {
      const response = await fetch("/api/resources/runs", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, ...command }) });
      if (!mounted.current) return;
      if (response.status === 401 || response.status === 403) { hideIdentity(); return; }
      const body: unknown = await response.json();
      if (!mounted.current) return;
      if (typeof body === "object" && body !== null && "ok" in body) {
        if (body.ok === false && "code" in body && typeof body.code === "string") {
          if (["unauthenticated", "forbidden"].includes(body.code)) { hideIdentity(); return; }
          setAttempt({ id: command.runId, state: "unknown", message: `${errorLabels[body.code] ?? "结果尚未确认。"} 请先核对本次记录，不会自动重试。` }); return;
        }
        if (response.ok && body.ok === true && "runId" in body && body.runId === command.runId && "status" in body && typeof body.status === "string" && Object.hasOwn(statusLabels, body.status)) {
          setAttempt({ id: command.runId, state: "saved", message: `${statusLabels[body.status as keyof typeof statusLabels]}。请打开本次记录审阅，正式路径没有改变。` }); return;
        }
      }
      setAttempt({ id: command.runId, state: "unknown", message: "结果尚未确认。请核对本次运行记录；不要重复发起。" });
    } catch { if (mounted.current) setAttempt({ id: command.runId, state: "unknown", message: "结果尚未确认。连接可能已中断，请核对本次运行记录；不会自动重试。" }); }
  }
  return { attempt, submit };
}
function Recovery({ attempt }: { attempt: Attempt | null }) {
  if (!attempt) return null;
  return <div className="resource-recovery"><Status tone={attempt.state === "pending" ? "progress" : attempt.state === "saved" ? "success" : "warning"}>{attempt.message}</Status>
    <a className="bp-button" href={`/resources/${attempt.id}`} target="_blank" rel="noopener">打开本次运行记录</a><p className="resource-muted">在新标签页打开，保留当前请求。可从记录页核对状态或取消；未知用量不等于零费用。</p></div>;
}
function IdentityLost() { return <Panel className="resource-card"><Status tone="warning">身份已变化，私人内容与历史记录已隐藏。请重新登录后打开本页。</Status><a className="bp-button" href="/login">重新登录</a></Panel>; }
function Heading({ title, goal, version }: { title: string; goal: string; version: number }) {
  return <header className="resource-heading"><div><p className="resource-eyebrow">BLUEPRINT / RESOURCE ATLAS</p><p className="resource-muted">{goal} · 蓝图 v{version}</p><h1>{title}</h1><p>找到合适的材料，把注意力留给真正的学习。</p></div><span className="resource-seal" aria-hidden="true">寻知</span></header>;
}
export function ResourceNodeWorkbench(props: { accountId: string; initial: ResourceNodeView; enabled: boolean }) {
  const owner = useRef(props.accountId);
  if (owner.current !== props.accountId) return <IdentityLost />;
  return <NodeWorkbench key={`${props.accountId}:${props.initial.nodeId}`} {...props} />;
}
function NodeWorkbench({ accountId, initial, enabled }: { accountId: string; initial: ResourceNodeView; enabled: boolean }) {
  const [hidden, setHidden] = useState(false), [regionCode, setRegion] = useState("");
  const [languageChoice, setLanguageChoice] = useState("zh"), [otherLanguage, setOtherLanguage] = useState("");
  const language = languageChoice === "other" ? otherLanguage : languageChoice;
  const [fallback, setFallback] = useState(false), [minutes, setMinutes] = useState("30"), [publishedAfter, setPublishedAfter] = useState("");
  const [startingPoint, setStartingPoint] = useState(""), [constraints, setConstraints] = useState("");
  const { attempt, submit } = useResourceAttempt(accountId, () => setHidden(true));
  const valid = /^[A-Z]{2}$/.test(regionCode) && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(language)
    && (minutes === "" || (Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 1440));
  if (hidden) return <IdentityLost />;
  function begin() {
    if (!enabled || attempt || !valid) return;
    void submit({ kind: "discover", runId: crypto.randomUUID(), nodeId: initial.nodeId, expectedBlueprintVersion: initial.blueprintVersion,
      preferences: { regionCode, language, allowLanguageFallback: fallback, maxDurationSeconds: minutes ? Number(minutes) * 60 : 86400,
        publishedAfter: publishedAfter ? `${publishedAfter}T00:00:00Z` : null }, learnerContext: { startingPoint: startingPoint.trim() || null, constraints: constraints.trim() || null } });
  }
  return <div className="resource-workbench"><Heading title={initial.nodeTitle} goal={initial.goalTitle} version={initial.blueprintVersion} />
    <nav className="resource-toolbar" aria-label="资源导航"><a href={`/paths/${initial.goalId}?node=${initial.nodeId}`}>返回对应目标路径</a><span>路径节点 / 学习资源</span></nav>
    <div className="resource-layout"><section className="resource-main"><Panel className="resource-card resource-intent"><p className="resource-eyebrow">01 / 学习依据</p><h2>先知道为什么学</h2><p>{initial.description || "节点尚未补充说明。"}</p><dl><dt>完成依据</dt><dd>{initial.completionCriteria || "尚未填写，请回到路径核对。"}</dd><dt>预计投入</dt><dd>{initial.estimatedMinutes === null ? "未指定" : `${initial.estimatedMinutes} 分钟`}</dd></dl></Panel>
      <Panel className="resource-card"><p className="resource-eyebrow">02 / 检索条件</p><h2>为这个节点寻找材料</h2>
        {!enabled && <Status tone="warning">资源服务暂未启用。已有记录仍可查看、核对和取消。</Status>}
        <p className="resource-muted">只检索真实视频并核对原生字幕，不会生成字幕，也不会自动添加到节点。</p>
        <form onSubmit={event => { event.preventDefault(); begin(); }}><fieldset disabled={attempt !== null || !enabled}><legend className="resource-sr-only">视频检索条件</legend>
          <div className="resource-fields"><label>观看地区代码<input aria-label="观看地区代码" required value={regionCode} onChange={event => setRegion(event.target.value.toUpperCase())} maxLength={2} pattern="[A-Z]{2}" list="resource-regions" placeholder="请选择或输入，例如 CN" autoComplete="off" /></label>
            <datalist id="resource-regions"><option value="CN">中国大陆</option><option value="HK">中国香港</option><option value="TW">中国台湾</option><option value="SG">新加坡</option><option value="US">美国</option><option value="GB">英国</option><option value="CA">加拿大</option><option value="AU">澳大利亚</option><option value="JP">日本</option></datalist>
            <label>字幕语言<select aria-label="字幕语言" value={languageChoice} onChange={event => setLanguageChoice(event.target.value)}>
              <option value="zh">中文</option><option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option><option value="fr">法语</option><option value="de">德语</option><option value="es">西班牙语</option><option value="other">其他语言</option>
            </select></label>
            {languageChoice === "other" && <label>其他字幕语言代码<input aria-label="其他字幕语言代码" required value={otherLanguage} onChange={event => setOtherLanguage(event.target.value)} maxLength={21} placeholder="例如 pt-BR 或 zh-Hans" autoComplete="off" /><span className="resource-muted">高级选项：输入字幕语言代码，可包含地区或书写形式。</span></label>}
            <label>单个视频时长上限（分钟）<input aria-label="单个视频时长上限（分钟）" type="number" min={1} max={1440} step={1} value={minutes} onChange={event => setMinutes(event.target.value)} /></label>
            <label>仅查找此日期之后发布的视频<input aria-label="最早发布日期" type="date" value={publishedAfter} onChange={event => setPublishedAfter(event.target.value)} /></label></div>
          <p className="resource-muted">地区由你明确选择，不读取地理位置。时长留空按 24 小时上限；日期留空保留基础经典内容。</p>
          <label className="resource-checkbox"><input type="checkbox" checked={fallback} onChange={event => setFallback(event.target.checked)} />允许使用其他语言的原生字幕</label>
          <details className="resource-context"><summary>补充我的起点与约束（可选）</summary><label>我的起点<textarea aria-label="我的起点" rows={3} maxLength={2000} value={startingPoint} onChange={event => setStartingPoint(event.target.value)} /></label><label>学习约束<textarea aria-label="学习约束" rows={3} maxLength={2000} value={constraints} onChange={event => setConstraints(event.target.value)} /></label></details>
          <div className="resource-actions"><Button type="submit" disabled={attempt !== null || !enabled || !valid}>查找视频</Button><span className="resource-muted">明确发起后预留 1 次检索机会</span></div>
        </fieldset></form><Recovery attempt={attempt} />
      </Panel></section>
      <aside><Panel className="resource-card resource-history"><p className="resource-eyebrow">RUN ARCHIVE</p><h2>运行记录</h2><p className="resource-muted">仅列出明确发起的操作。打开记录会核对最新状态，不会重新执行。</p>
        {initial.records.length ? <ol>{initial.records.map((record, index) => <li key={record.id}><span className="resource-index">{String(initial.offset + index + 1).padStart(2, "0")}</span><div><a href={`/resources/${record.id}`}>{kindLabels[record.kind]}</a><time dateTime={record.createdAt}>{dateLabel(record.createdAt)}</time></div></li>)}</ol> : <p>还没有运行记录。开始检索后，这里会保留恢复入口。</p>}
        <nav className="resource-actions" aria-label="运行记录分页">{initial.offset > 0 && <a href={`/resources/nodes/${initial.nodeId}?page=${Math.max(1, Math.floor(initial.offset / 20))}`}>上一页</a>}{initial.hasMore && <a href={`/resources/nodes/${initial.nodeId}?page=${Math.floor(initial.offset / 20) + 2}`}>下一页</a>}</nav>
      </Panel><p className="resource-aside-note">检索、字幕核对与匹配分别计次。建议不是承诺，也不会自动写入正式路径。</p></aside></div>
  </div>;
}

export function ResourceRunReview(props: ResourceRunReviewProps) {
  const owner = useRef(props.accountId);
  if (owner.current !== props.accountId) return <IdentityLost />;
  return <RunReview key={`${props.accountId}:${props.initial.id}`} {...props} />;
}
function RunReview({ accountId, initial, enabled, adoptionEnabled = false, readAction, cancelAction, clearAction }: ResourceRunReviewProps) {
  const [run, setRun] = useState(initial), [hidden, setHidden] = useState(false), [message, setMessage] = useState("");
  const [reading, setReading] = useState(false), [cancelling, setCancelling] = useState(false), [needsRead, setNeedsRead] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false), [clearing, setClearing] = useState(false), [concealed, setConcealed] = useState(false);
  const revision = useRef(0), mounted = useRef(true), locks = useRef({ read: false, cancel: false, clear: false });
  const lifetime = useEvidenceDeadline(run.status === "cleared" ? null : run.contentExpiresAt);
  const { attempt, submit } = useResourceAttempt(accountId, () => setHidden(true));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++; }; }, []);
  async function perform(kind: "read" | "cancel" | "clear", action: () => Promise<ResourceUiResult<ResourceRunView>>) {
    if (hidden || locks.current[kind] || locks.current.clear || (kind === "read" && locks.current.cancel)) return;
    locks.current[kind] = true; const current = ++revision.current;
    if (kind === "read") setReading(true); else if (kind === "cancel") setCancelling(true);
    else { setClearing(true); setConcealed(true); setConfirmClear(false); }
    setMessage(""); setNeedsRead(true);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (!result.ok && ["unauthenticated", "forbidden", "not_found"].includes(result.code)) { setHidden(true); return; }
      if (current !== revision.current) return;
      if (!result.ok) { setMessage(kind === "clear" || concealed ? "清除结果尚未确认，旧材料已隐藏。请读取最新状态；不会自动重试清除。" : "暂时无法核对。下方是上次保存的内容，请重新读取；不会自动执行。 "); return; }
      if (result.value.id !== initial.id || result.value.nodeId !== initial.nodeId) { setHidden(true); return; }
      if (kind === "clear" && result.value.status !== "cleared") { setMessage("清除结果尚未确认，旧材料已隐藏。请读取最新状态。"); return; }
      setRun(result.value); setNeedsRead(false); setConcealed(false); setMessage(`已核对：${statusLabels[result.value.status]}。没有发起检索或模型调用。`);
    } catch { if (mounted.current && current === revision.current) setMessage("结果尚未确认。网络可能已中断，请读取最新状态；不会自动重试。"); }
    finally {
      locks.current[kind] = false;
      if (mounted.current) { if (kind === "read") setReading(false); else if (kind === "cancel") setCancelling(false); else setClearing(false); }
    }
  }
  if (hidden) return <IdentityLost />;
  if (concealed) return <div className="resource-workbench resource-evidence-notice"><Panel className="resource-card"><h1>正在核对证据清除状态</h1>
    <Status tone={clearing || reading ? "progress" : "warning"}>{message || "已隐藏旧材料，正在清除这条检索链的证据…"}</Status>
    <div className="resource-actions"><Button disabled={clearing || reading} onClick={() => void perform("read", readAction)}>读取最新状态</Button><a className="bp-button" href="/paths">返回路径</a></div></Panel></div>;
  if (run.status === "cleared") return <ClearedEvidence receipt={run} />;
  if (lifetime !== "available") return <EvidenceDeadlineNotice state={lifetime} busy={reading || cancelling || clearing} message={message} onRead={() => void perform("read", readAction)} />;
  const active = run.status === "queued" || run.status === "running";
  const canContinue = run.status === "ready" && run.nextKind !== null && run.childId === null;
  const result = run.result;
  function next() {
    if (!enabled || !canContinue || !run.nextKind || attempt || needsRead || reading || cancelling || Date.parse(run.contentExpiresAt) <= Date.now()) return;
    void submit({ kind: run.nextKind, runId: crypto.randomUUID(), sourceRunId: run.id });
  }
  return <div className="resource-workbench"><Heading title={run.nodeTitle} goal={run.goalTitle} version={run.blueprintVersion} />
    <nav className="resource-toolbar" aria-label="资源导航"><a href={`/paths/${run.goalId}?node=${run.nodeId}`}>返回对应目标路径</a><a href={`/resources/nodes/${run.nodeId}`}>返回节点资源与历史</a><span>{kindLabels[run.kind]} · {dateLabel(run.createdAt)}</span></nav>
    <Panel className="resource-card resource-run-status"><div><p className="resource-eyebrow">RUN / REVIEW ONLY</p><h2>{statusLabels[run.status]}</h2><p>这是可审阅的资源记录。匹配建议不会自动绑定到节点，也不证明学习已完成。</p></div>
      <div className="resource-actions"><Button disabled={reading || cancelling} onClick={() => void perform("read", readAction)}>读取最新状态</Button>{active && <Button disabled={cancelling} onClick={() => void perform("cancel", cancelAction)}>取消本次运行</Button>}</div>
      {reading || cancelling ? <Status tone="progress">正在核对云端记录…</Status> : null}{message && <Status tone={needsRead ? "warning" : "neutral"}>{message}</Status>}
      <p className="resource-muted">证据使用期限：<time dateTime={run.contentExpiresAt}>{dateLabel(run.contentExpiresAt)}</time>。后续匹配与核验不会延长期限。</p>
      {run.status === "stale" && <Status tone="warning">蓝图来源已变化。以下是历史版本的材料与建议，不能作为当前节点的匹配结果。</Status>}
      {active && <p className="resource-muted">本页不会轮询。可保存本页地址稍后返回；取消已开始的操作不保证供应商停止计费。</p>}
      {run.status === "interrupted" && <Status tone="warning">执行已中断，结果不完整。不会自动重新检索、读取字幕或调用模型。</Status>}
      {run.status === "cancelled" && <p>本次运行已取消，迟到结果不会恢复执行。不能据此判断没有产生用量。</p>}
      {run.status === "failed" && <Status tone="warning">{errorLabels[result?.status ?? ""] ?? "本次没有完成有效结果。"} 原路径没有改变，不会自动重试。</Status>}
    </Panel>
    {clearAction && <Panel className="resource-card resource-clearing"><h2>管理这条检索链的证据</h2><p>只清理检索与核验材料，不删除你的正式路径或学习记录。</p>
      {confirmClear ? <section aria-label="清除证据确认"><h3>确认清除整条检索链？</h3><p>这将清除同一次检索及后续字幕、匹配、采用核验的正文、检索条件与起点说明。清除不可恢复；正在执行的结果不会再保存，未确认的资源变更会被拒绝。</p>
        <p>正式路径、已确认的变更、绑定、笔记与学习历史保持不变。已发出的提供方请求不保证停止计费；其他已打开页面需重新读取。这不是账号、处理商或备份删除。</p>
        <div className="resource-actions"><Button disabled={cancelling} onClick={() => void perform("clear", clearAction)}>确认清除证据</Button><Button onClick={() => setConfirmClear(false)}>保留证据</Button></div>
      </section> : <Button disabled={cancelling || attempt !== null} onClick={() => setConfirmClear(true)}>清除这条检索链的证据</Button>}
    </Panel>}
    <div className="resource-layout"><section className="resource-main" aria-label="资源审阅结果">
      {result ? <><Panel className="resource-card resource-result-heading"><p className="resource-eyebrow">EVIDENCE / NOT A PROMISE</p><h2>{result.status === "matched" ? "有依据的匹配建议" : result.status === "no_match" ? "本次没有推荐" : "候选材料"}</h2>
        {result.summary && <p className="resource-summary">{result.summary}</p>}
        {result.status === "no_candidates" && <p>没有找到符合本次筛选条件的视频。不会用示例或未经检索的链接填充。</p>}
        {result.status === "no_evidence" && <p>没有足够的原生字幕证据，不提供无依据的推荐。</p>}
        {result.status === "no_match" && <p>候选未达到这次匹配要求。保留拒绝理由，不强行推荐一个视频。</p>}
        {!["discovered", "matched", "no_match", "no_candidates"].includes(result.status) && result.candidates.length > 0 && <Status tone="warning">本次依据中的候选：以下保留之前的检索材料，不是本次成功推荐，也不代表字幕已重新核对。</Status>}
        {result.uninspectedCount > 0 && <p className="resource-muted">另有 {result.uninspectedCount} 个候选尚未核对字幕；未参与本次匹配。</p>}
        {result.rejected.length > 0 && <details><summary>查看 {result.rejected.length} 条筛选排除记录</summary><ul>{result.rejected.map(item => <li key={`${item.videoId}:${item.reason}`}><code>{item.videoId}</code> · {rejectionLabel(item.reason)}</li>)}</ul></details>}
      </Panel>{result.candidates.map((candidate, index) => <div className="resource-candidate-group" key={candidate.videoId}><Candidate candidate={candidate} index={index} />
        {run.status === "ready" && result.status === "matched" && candidate.assessment && candidate.assessment.role !== "rejected" && <Panel className="resource-card">
          <AdoptionStart accountId={accountId} sourceRunId={run.id} videoId={candidate.videoId} bindings={run.bindings ?? []}
            enabled={adoptionEnabled && !needsRead && !reading && !cancelling} onIdentityLost={() => setHidden(true)} />
        </Panel>}</div>)}</> : <Panel className="resource-card resource-empty"><p className="resource-eyebrow">AWAITING EVIDENCE</p><h2>尚无可展示的材料</h2><p>等待真实检索与字幕证据。这里不会预填推荐内容。</p></Panel>}
    </section><aside className="resource-aside"><Panel className="resource-card"><p className="resource-eyebrow">NEXT / EXPLICIT ACTION</p><h2>下一步由你决定</h2>
      {!enabled && <Status tone="warning">资源服务暂未启用。仍可读取记录、取消运行与查看历史。</Status>}
      {run.childId ? <><p>这个结果已有后续运行，包括已取消或中断的运行。不会重复创建另一个分支。</p><a className="bp-button" href={`/resources/${run.childId}`}>查看已有后续运行</a></> : canContinue ? <>
        <p>{run.nextKind === "captions" ? "部分原生字幕仍在处理。下一次只读取已有任务，不会重新启动字幕任务。" : "用已有原生字幕与节点要求生成可审阅的匹配建议。"}</p>
        <Button disabled={!enabled || attempt !== null || needsRead || reading || cancelling} onClick={next}>{run.nextKind === "captions" ? "读取待处理字幕" : "生成匹配建议"}</Button><p className="resource-muted">此操作独立预留 1 次机会，不会自动进行下一阶段。</p></> : <p>当前记录没有可执行的后续阶段。请先核对状态；历史或失败记录不会自动续跑。</p>}
      <Recovery attempt={attempt} />
    </Panel><Panel className="resource-card resource-source"><h2>本次条件</h2><dl><dt>观看地区 / 字幕语言</dt><dd>{run.preferences.regionCode} / {run.preferences.language}</dd><dt>字幕语言回退</dt><dd>{run.preferences.allowLanguageFallback ? "已允许其他原生字幕语言" : "仅使用所选语言"}</dd>
      <dt>视频时长上限</dt><dd>{Math.round(run.preferences.maxDurationSeconds / 60)} 分钟</dd><dt>最早发布日期</dt><dd>{run.preferences.publishedAfter?.slice(0, 10) ?? "不限，保留基础内容"}</dd>
      {run.learnerContext.startingPoint && <><dt>我的起点</dt><dd>{run.learnerContext.startingPoint}</dd></>}{run.learnerContext.constraints && <><dt>学习约束</dt><dd>{run.learnerContext.constraints}</dd></>}
      {run.skillVersion && <><dt>匹配规则版本</dt><dd>{run.skillVersion}</dd></>}</dl>
      {run.sourceRunId && <a href={`/resources/${run.sourceRunId}`}>查看上一步来源</a>}
      <p className="resource-muted">次数不等于人民币账单。推荐不是质量保证；正式绑定需要重新核验与明确确认。</p>
      {!!run.adoptions?.length && <section><h3>采用记录</h3><p className="resource-muted">最近 20 条；打开核对状态，不会重新核验。</p><ol>{run.adoptions.map(item => <li key={item.id}><a href={`/resources/adoptions/${item.id}`}>YouTube · {item.videoId}</a><p className="resource-muted">{dateLabel(item.createdAt)}</p></li>)}</ol></section>}
    </Panel></aside></div>
  </div>;
}
function rejectionLabel(reason: string) {
  const labels: Record<string, string> = { not_public: "视频未公开", not_processed: "视频尚未处理完成", live_or_upcoming: "直播或待发布内容", region_restricted: "观看地区受限", age_restricted: "年龄限制", duration_exceeded: "超出时长上限", future_publication: "发布时间尚未到达", before_requested_date: "早于指定日期" };
  return labels[reason] ?? "未通过筛选";
}
function Candidate({ candidate, index }: { candidate: ResourceCandidateView; index: number }) {
  const url = /^[A-Za-z0-9_-]{11}$/.test(candidate.videoId) && candidate.url === `https://www.youtube.com/watch?v=${candidate.videoId}` ? candidate.url : null;
  const assessment = candidate.assessment;
  const caption = candidate.transcriptStatus === "ready" ? `原生字幕 · ${candidate.language ?? "语言待核对"}` : candidate.transcriptStatus === "pending" ? "原生字幕处理中" : candidate.transcriptStatus === "not_found" ? "未找到原生字幕" : "本次未能核对原生字幕";
  const roles = { recommended: "建议优先查看", alternative: "备选材料", rejected: "本次不推荐" };
  return <Panel className="resource-card resource-candidate"><header className="resource-candidate-header"><span className="resource-index">{String(index + 1).padStart(2, "0")}</span><div><p className="resource-eyebrow">{assessment ? roles[assessment.role] : "检索候选 / 尚非推荐"}</p><h3>{candidate.title}</h3><p className="resource-muted">{candidate.channel} · {candidate.publishedAt.slice(0, 10)} · {Math.ceil(candidate.durationSeconds / 60)} 分钟</p></div></header>
    <div className="resource-tags"><span>{caption}</span>{candidate.languageFallback && <span>使用其他语言字幕</span>}<span>{candidate.eligible ? "可用于字幕匹配" : "尚不能用于匹配"}</span></div>
    {url && <a className="resource-video-link" href={url} target="_blank" rel="noopener noreferrer">在 YouTube 查看视频 ↗</a>}
    <p className="resource-muted">链接基于检索时的记录；当前可播放性、地区与内容可能变化。</p>
    {assessment && <><dl className="resource-assessment"><dt>与节点的关系</dt><dd>{assessment.relevance}</dd><dt>起点与难度</dt><dd>{assessment.levelFit}</dd><dt>语言要求</dt><dd>{assessment.languageFit}</dd><dt>时间投入</dt><dd>{assessment.timeFit}</dd><dt>时效判断</dt><dd>{assessment.freshness}</dd></dl>
      {assessment.limitations.length > 0 && <div className="resource-limitations"><h4>使用前留意</h4><ul>{assessment.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul></div>}
      <section className="resource-evidence" aria-label="字幕依据"><h4>为什么这样判断</h4>{assessment.evidence.map((evidence, i) => { const seconds = Number.isFinite(evidence.offsetMs) && evidence.offsetMs >= 0 && evidence.offsetMs <= Number.MAX_SAFE_INTEGER ? Math.floor(evidence.offsetMs / 1000) : null;
        return <blockquote key={i}><p>{evidence.quote}</p>{url && seconds !== null && <a href={`${url}&t=${seconds}s`} target="_blank" rel="noopener noreferrer">跳到 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} 的字幕位置 ↗</a>}</blockquote>; })}
        <p className="resource-muted">抽样 {assessment.sampledSegments} / {assessment.totalSegments} 段字幕{assessment.textTruncated ? "，部分文字已截取" : ""}；不是对完整视频的质量认证。</p>
      </section></>}
  </Panel>;
}
