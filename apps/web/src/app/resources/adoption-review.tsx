"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";
import type { AdoptionReviewProps, AdoptionView, ResourceBindingView } from "./adoption-view";
import type { ResourceUiResult } from "./resource-view";
import "./resource-workbench.css";

const labels = { queued: "等待核验", running: "正在重新核验视频", ready: "请确认资源变更", failed: "本次核验未通过", cancelled: "已取消核验",
  interrupted: "核验已中断", stale: "这份核验已过期", applied: "已绑定到正式路径", rejected: "已拒绝这份变更" };
const outcomes: Record<string, string> = { changed: "视频元信息与匹配时不同，请重新检索与匹配后再决定。", not_available: "视频已不满足本次地区或筛选条件。",
  not_found: "提供方没有返回这个视频。", unavailable: "暂时无法核验视频。", rate_limited: "提供方暂时限流。", timed_out: "核验没有在期限内完成。", invalid_input: "来源或输入已不适用于本次核验。" };
const verificationTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });
function IdentityLost() { return <Panel><Status tone="warning">身份已变化，私人资源内容已隐藏。请重新登录。</Status><a href="/login">重新登录</a></Panel>; }
function Bindings({ title, items }: { title: string; items: ResourceBindingView[] }) {
  return <section><h3>{title}</h3>{items.length ? <ol>{items.map(item => <li key={item.id}><span>YouTube · {item.videoId}</span></li>)}</ol> : <p>没有绑定视频</p>}</section>;
}
export function AdoptionStart({ accountId, sourceRunId, videoId, bindings, enabled, onIdentityLost }: {
  accountId: string; sourceRunId: string; videoId: string; bindings: ResourceBindingView[]; enabled: boolean; onIdentityLost: () => void;
}) {
  const [choice, setChoice] = useState(bindings.length ? "" : "append"), [attempt, setAttempt] = useState<{ id: string; message: string } | null>(null);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function begin() {
    if (!enabled || lock.current || !choice) return;
    lock.current = true; const adoptionId = crypto.randomUUID();
    setAttempt({ id: adoptionId, message: "正在核验。记录可能尚未创建，请勿重复发起。" });
    try {
      const response = await fetch("/api/resources/runs", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "adopt", adoptionId, sourceRunId, videoId, replaceBindingId: choice === "append" ? null : choice, accountId }) });
      if (!mounted.current) return;
      if (response.status === 401 || response.status === 403) { onIdentityLost(); return; }
      const body: unknown = await response.json(); if (!mounted.current) return;
      if (typeof body === "object" && body !== null && "ok" in body) {
        if (body.ok === true && response.ok && "adoptionId" in body && body.adoptionId === adoptionId) {
          setAttempt({ id: adoptionId, message: "核验记录已保存，请打开采用记录查看结果；正式路径尚未改变。" }); return;
        }
        if (body.ok === false && "code" in body) {
          if (body.code === "unauthenticated" || body.code === "forbidden") { onIdentityLost(); return; }
          const reason = body.code === "quota_exhausted" ? "核验次数不足。" : body.code === "disabled" ? "资源采用暂未启用。" : body.code === "version_conflict" ? "来源已变化。" : "";
          setAttempt({ id: adoptionId, message: `${reason}结果尚未确认，请核对采用记录；不会自动重试。` }); return;
        }
      }
    } catch { /* Unknown outcomes are recovered by reading, never automatically retried. */ }
    if (mounted.current) setAttempt({ id: adoptionId, message: "结果尚未确认，请核对采用记录；不会自动重试。" });
  }
  return <section className="resource-adoption-start" aria-label="采用这条候选"><h4>把资源加入路径</h4>
    <p className="resource-muted">先重新核验视频并准备提案，再由你明确确认。核验独立预留 1 次机会，不调用模型或字幕服务。</p>
    {!enabled && <Status tone="warning">资源采用暂未启用；已有采用记录仍可读取、取消或确认。</Status>}
    {bindings.length > 0 && <label>资源变更方式<select aria-label="资源变更方式" value={choice} disabled={!enabled || attempt !== null} onChange={event => setChoice(event.target.value)}>
      <option value="">请选择新增或替换</option>{bindings.length < 16 && <option value="append">新增，保留已有视频</option>}
      {bindings.map(binding => <option key={binding.id} value={binding.id}>替换 YouTube · {binding.videoId}</option>)}
    </select></label>}
    <Button disabled={!enabled || attempt !== null || !choice || bindings.some(binding => binding.videoId === videoId)} onClick={() => void begin()}>核验并准备采用</Button>
    {bindings.some(binding => binding.videoId === videoId) && <p>这个视频已在节点中，不重复绑定。</p>}
    {attempt && <div className="resource-recovery"><Status tone="neutral">{attempt.message}</Status><a className="bp-button" href={`/resources/adoptions/${attempt.id}`} target="_blank" rel="noopener">打开本次采用记录</a></div>}
  </section>;
}
export function AdoptionReview(props: AdoptionReviewProps) {
  const owner = useRef(props.accountId);
  if (owner.current !== props.accountId) return <IdentityLost />;
  return <Review key={`${props.accountId}:${props.initial.id}`} {...props} />;
}
function Review({ initial, readAction, cancelAction, rejectAction, applyAction }: AdoptionReviewProps) {
  const [view, setView] = useState(initial), [hidden, setHidden] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function perform(action: () => Promise<ResourceUiResult<AdoptionView>>) {
    if (lock.current || hidden) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await action(); if (!mounted.current) return;
      if (!result.ok) {
        if (["unauthenticated", "forbidden", "not_found"].includes(result.code)) { setHidden(true); return; }
        setUncertain(true); setMessage("结果尚未确认，请先读取最新记录；不会自动重复确认或核验。"); return;
      }
      if (result.value.id !== initial.id || result.value.sourceRunId !== initial.sourceRunId) { setHidden(true); return; }
      setView(result.value); setUncertain(false); setMessage(`已核对：${labels[result.value.status]}。`);
    } catch { if (mounted.current) { setUncertain(true); setMessage("结果尚未确认，请先读取最新记录；不会自动重复确认或核验。"); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (hidden) return <IdentityLost />;
  return <div className="resource-workbench"><header className="resource-heading"><div><p className="resource-eyebrow">RESOURCE / YOUR DECISION</p><p>{view.goalTitle} · 蓝图 v{view.blueprintVersion}</p><h1>{view.nodeTitle}</h1><p>先核对变更，再决定是否放进路径。</p></div><span className="resource-seal" aria-hidden="true">择学</span></header>
    <nav className="resource-toolbar" aria-label="采用导航"><a href={`/resources/${view.sourceRunId}`}>返回匹配依据</a><a href={`/paths/${view.goalId}?node=${view.nodeId}`}>返回对应目标路径</a></nav>
    <Panel className="resource-card"><p className="resource-eyebrow">VERIFICATION / CONFIRMATION</p><h2>{labels[view.status]}</h2>
      <h3>{view.selected.title}</h3><p>{view.selected.channel} · YouTube {view.selected.videoId}</p>
      <p>{view.replaceBindingId ? "将替换你选择的绑定；旧学习记录仍保留原视频归属。" : "将新增一个可选视频；其他资源与学习状态保持不变。"}</p>
      {view.status === "stale" && <Status tone="warning">蓝图来源已变化或十分钟核验窗口已结束，不能确认旧提案。重新核验必须由你另行发起，不会自动消费。</Status>}
      {view.outcome && outcomes[view.outcome] && <Status tone="warning">{outcomes[view.outcome]}</Status>}
      {view.verifiedAt && view.validUntil && <div className="resource-muted"><p>核验时间：<time dateTime={view.verifiedAt}>{verificationTime.format(new Date(view.verifiedAt))}</time>（北京时间）</p>
        <p>有效期至：<time dateTime={view.validUntil}>{verificationTime.format(new Date(view.validUntil))}</time>（北京时间）</p>
        <p>只证明核验时符合元信息检查，不保证此刻可播放或适合所有学习场景。</p></div>}
      {view.status === "applied" && <Status tone="success">资源已写入正式蓝图 v{view.proposal?.appliedVersion}；没有将节点标记为完成。</Status>}
      {(view.status === "queued" || view.status === "running") && <p>本页不会轮询；可稍后读取或取消。取消已开始的请求不保证没有产生用量。</p>}
      {view.status === "cancelled" && <p>不会接受迟到结果或自动重新核验；未知用量不等于零费用。</p>}
      {view.after && <div className="resource-fields"><Bindings title="变更前" items={view.before} /><Bindings title="本次提案" items={view.after} /></div>}
      <div className="resource-actions"><Button disabled={busy} onClick={() => void perform(readAction)}>读取采用记录</Button>
        {(view.status === "queued" || view.status === "running") && <Button disabled={busy} onClick={() => void perform(cancelAction)}>取消本次核验</Button>}
        {view.status === "ready" && view.proposal?.status === "pending" && <Button disabled={busy || uncertain} onClick={() => void perform(() => applyAction(view.proposal!.id, view.blueprintVersion))}>确认并绑定资源</Button>}
        {view.proposal?.status === "pending" && <Button disabled={busy || uncertain} onClick={() => void perform(rejectAction)}>拒绝这份资源变更</Button>}
      </div>{busy && <Status tone="progress">正在核对云端记录…</Status>}{message && <Status tone={uncertain ? "warning" : "neutral"}>{message}</Status>}
      <p className="resource-muted">读取、确认与拒绝不会重新调用视频或模型服务。确认时云端再次核对账号、来源版本与核验有效期。</p>
    </Panel></div>;
}
