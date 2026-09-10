"use client";

import { useRef, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";
import type { PlanningRun } from "@/lib/agent/planning-run";
import type { RunResponse } from "@/lib/agent/planning-access";
import type { PlanningApprovalResponse } from "@/lib/agent/planning-approval";
import { PlanningApproval, type ApprovalActions } from "./planning-approval";

export type PlanningResponse = RunResponse | { ok: false; code: "unauthenticated" };
type Props = { accountId: string; initial: PlanningRun; readAction: () => Promise<PlanningResponse>; cancelAction: () => Promise<PlanningResponse>;
  approval?: { initial: PlanningApprovalResponse; actions: ApprovalActions } };
const labels = { queued: "等待执行", running: "正在规划", ready: "草案已保存", stale: "来源已变化", cancelled: "已取消", interrupted: "执行已中断", failed: "本次未完成" };
const kinds = { learn: "学习", practice: "实践", checkpoint: "检查点", reflection: "复盘" };

export function PlanningReview(props: Props) {
  if (props.initial.ownerId !== props.accountId) return <Status tone="warning">账号已变化，请重新登录后打开规划记录。</Status>;
  return <ReviewSession key={`${props.accountId}:${props.initial.id}`} {...props} />;
}

function ReviewSession({ accountId, initial, readAction, cancelAction, approval }: Props) {
  const [run, setRun] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const approvalIdentity = approval?.initial;
  const [hidden, setHidden] = useState(Boolean(approvalIdentity && (approvalIdentity.ok
    ? approvalIdentity.value.ownerId !== accountId || approvalIdentity.value.runId !== initial.id
    : ["unauthenticated", "forbidden", "not_found"].includes(approvalIdentity.code))));
  const locked = useRef(false);
  async function perform(action: () => Promise<PlanningResponse>) {
    if (locked.current || hidden) return;
    locked.current = true; setBusy(true); setMessage(""); setAnnouncement("");
    try {
      const result = await action();
      if (!result.ok) {
        if (["unauthenticated", "forbidden", "not_found"].includes(result.code)) { setHidden(true); return; }
        setMessage("暂时无法核对，下面保留的内容不是最新状态。请重新读取，不会自动生成或应用路径。"); return;
      }
      if (result.run.ownerId !== accountId || result.run.id !== initial.id) { setHidden(true); return; }
      setRun(result.run);
      setAnnouncement(`已核对云端记录：${labels[result.run.status]}。`);
    } catch { setMessage("网络中断，下面保留的内容不是最新状态。请重新读取，不会自动生成或应用路径。"); }
    finally { locked.current = false; setBusy(false); }
  }
  if (hidden) return <Panel className="brief-card"><Status tone="warning">当前身份无法访问这份记录，私人内容已隐藏。请重新登录后打开本页。</Status><a href={`/login?next=${encodeURIComponent(`/planning/${initial.id}`)}`} className="bp-button">重新登录</a></Panel>;
  const result = run.result;
  const ready = result?.status === "ready" ? result : null;
  const existingIds = new Set(run.blueprint.goals.map(goal => goal.id));
  const proposed = ready?.draft.goals.filter(goal => !existingIds.has(goal.id)) ?? [];
  const weeks = new Map(ready?.schedule.map(item => [item.nodeId, item.week]));
  const nodes = proposed.flatMap(goal => goal.stages.flatMap(stage => stage.nodes));
  const totals = new Map<number, number>();
  for (const node of nodes) { const week = weeks.get(node.id); if (week) totals.set(week, (totals.get(week) ?? 0) + (node.estimatedMinutes ?? 0)); }
  const active = run.status === "queued" || run.status === "running";
  return <>
    <Panel className="brief-card planning-status">
      <div><p className="brand">PATH / REVIEW</p><h1>{labels[run.status]}</h1><p>这是规划记录，不是正式路径。阅读与刷新不会调用模型。</p></div>
      <div className="brief-actions"><Button disabled={busy} onClick={() => void perform(readAction)}>刷新运行状态</Button>
        {active && <Button disabled={busy} onClick={() => void perform(cancelAction)}>取消本次规划</Button>}</div>
      <Status tone={busy ? "progress" : "neutral"}>{busy ? "正在核对云端记录…" : announcement}</Status>
      {message && <Status tone="warning">{message}</Status>}
      {run.status === "stale" && <Status tone="warning">目标定义或蓝图已修改。以下是旧来源的建议，不能当作当前可应用草案。</Status>}
      {active && <p className="subtle">可离开并通过本页地址返回。不会因为刷新而重新生成；取消执行中的请求不保证供应商停止计费。</p>}
      {(run.status === "interrupted" || run.status === "failed") && <Status tone="warning">{result?.status === "timed_out" ? "等待结果超时。" : "本次没有完成有效规划。"}原蓝图未改变，不会自动重试。</Status>}
      {run.status === "cancelled" && <p>{run.skill !== null ? "执行权已领取，次数不会自动归还；迟到建议不会被采用。" : "未领取执行权的预留次数已归还。"}</p>}
    </Panel>
    <div className="planning-columns">
      <aside className="planning-source"><Panel className="brief-card"><p className="brand">规划依据</p><h2>{run.brief.content.outcome}</h2>
        <dl><dt>我的起点</dt><dd>{run.brief.content.startingPoint}</dd><dt>每周投入</dt><dd>{run.brief.content.weeklyMinutes} 分钟</dd>
          <dt>约束</dt><dd>{run.brief.content.constraints || "未补充约束"}</dd><dt>成功依据</dt><dd>{run.brief.content.successCriteria}</dd>
          <dt>规划起始日</dt><dd>{run.startDate}</dd><dt>目标期限</dt><dd>{run.brief.content.targetDate ?? "未指定期限"}</dd></dl>
        <p className="subtle">目标定义 r{run.briefRevision} · 蓝图 v{run.blueprintVersion}</p>
        <a href={`/goals/${run.briefId}`} className="brief-open">回到目标定义</a>
      </Panel><Panel className="brief-card"><h2>运行依据</h2><p>{run.skill ? `规划规则 ${run.skill.version}` : "尚未登记执行规则"}</p>
        <p>Token 用量：{result?.usage?.totalTokens ?? "尚未确认"}</p><p className="subtle">次数额度不等于人民币账单。未知用量不表示零费用。</p>
        {run.skill && <details><summary>规则指纹</summary><code>{run.skill.sha256}</code></details>}
      </Panel></aside>
      <section className="planning-path" aria-label="待审阅建议">
        {ready ? <>
          <Panel className="brief-card"><p className="brand">建议，不是承诺</p><h2>每周安排</h2><p>本次新增 {nodes.length} 个节点；保留原有 {run.blueprint.goals.length} 个目标。</p>
            <ol className="planning-weeks">{[...totals].sort(([a], [b]) => a - b).map(([week, minutes]) => <li key={week}><span>第 {week} 周</span><strong>{minutes} / {run.brief.content.weeklyMinutes} 分钟</strong></li>)}</ol>
            <h3>规划中的假设</h3>{ready.assumptions.length ? <ul>{ready.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>没有补充假设。</p>}
          </Panel>
          {proposed.map(goal => <Panel className="brief-card" key={goal.id}><h2>{goal.title}</h2><p>{goal.description}</p>
            {goal.stages.map(stage => <section key={stage.id}><h3>{stage.title}</h3><ol className="planning-nodes">{stage.nodes.map(node => <li key={node.id}>
              <p className="brand">第 {weeks.get(node.id)} 周 · {kinds[node.type]} · {node.estimatedMinutes} 分钟</p><h4>{node.title}</h4><p>{node.description}</p>
              <p><strong>完成依据：</strong>{node.completionCriteria}</p>
              {node.dependencyIds.length > 0 && <p className="subtle">先完成：{node.dependencyIds.map(id => nodes.find(item => item.id === id)?.title ?? "未知前置节点").join("、")}</p>}
            </li>)}</ol></section>)}
          </Panel>)}
          {approval && <PlanningApproval accountId={accountId} runId={run.id} runStatus={run.status} initial={approval.initial}
            actions={approval.actions} onIdentityLost={() => setHidden(true)} />}
        </> : <Panel className="brief-card"><h2>这里将保留可审阅的建议</h2><p>尚无可展示的完整草案。取消或失败不会用示例内容填充你的路径。</p></Panel>}
      </section>
    </div>
  </>;
}
