"use client";

import { useState } from "react";
import type { ApplicationResult, GoalProgressView, ProgressEvidence } from "@blueprint/domain";
import { Status } from "@blueprint/ui";
import "./home-dashboard.css";

type Props = { goals: GoalProgressView[]; evidence: ApplicationResult<ProgressEvidence[]> };
const nodeKinds = { learn: "学习", practice: "实践", checkpoint: "检查点", reflection: "复盘" };
const pathHref = (goalId: string, nodeId?: string) => `/paths/${encodeURIComponent(goalId)}${nodeId ? `?node=${encodeURIComponent(nodeId)}` : ""}`;

export function HomeDashboard({ goals, evidence }: Props) {
  const [focusId, setFocusId] = useState(goals[0]?.goal.id ?? "");
  const visibleGoals = goals.slice(0, 5);
  const focused = visibleGoals.find(item => item.goal.id === focusId) ?? visibleGoals[0];
  const next = focused?.next;
  const blockedNames = next?.blockedBy.map(id => goals.flatMap(item => item.nodes).find(item => item.node.id === id)?.node.title ?? "未自确认的前置节点") ?? [];
  return <div className="home-dashboard">
    <div className="home-dashboard-heading"><div><span className="brand">Your blueprint / 此刻的方向</span><h2>把想改变的事，变成下一步。</h2></div><a href="/paths">完整目标列表（{goals.length}） <span aria-hidden="true">↗</span></a></div>
    <div className="home-dashboard-stage">
      <section className="home-goal-rail" aria-label="选择当前关注目标">
        {!visibleGoals.length ? <div className="home-empty-module"><span className="home-goal-index" aria-hidden="true">＋</span><h3>给改变一个方向</h3><p>这里将展示你亲自确认的目标，而不是演示数据。</p><a href="/goals/new">先定义一个目标</a></div> : null}
        {visibleGoals.map((item, index) => <button key={item.goal.id} type="button" className="home-goal-module"
          aria-label={`关注目标：${item.goal.title}`} aria-pressed={item.goal.id === focused?.goal.id} onClick={() => setFocusId(item.goal.id)}>
          <span className="home-goal-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <span className="home-goal-copy"><strong>{item.goal.title}</strong><span>{item.next?.stageTitle ?? (item.awaitingPlan ? "等待规划" : "路径概览")}</span>
            <span className="home-goal-next">{item.next?.node.title ?? (item.allSelfConfirmed ? "全部节点已自确认" : "查看目标路径")}</span><small>已自确认检查点 {item.confirmedCheckpoints}{item.needsReviewCount ? ` · ${item.needsReviewCount} 项待复核` : ""}</small></span>
        </button>)}
      </section>
      <section className="home-identity" aria-label="个人身份静态回退">
        <div className="home-identity-coordinate" aria-hidden="true">PERSONAL ATLAS<br />OWN YOUR DIRECTION</div>
        <svg className="home-identity-figure" viewBox="0 0 320 450" aria-hidden="true" focusable="false">
          <g className="home-identity-orbit" fill="none"><ellipse cx="160" cy="390" rx="116" ry="29" /><ellipse cx="160" cy="390" rx="85" ry="19" /><path d="M38 300V154l46-47M282 300V154l-46-47M105 39h110" /></g>
          <g className="home-identity-body"><path d="M138 74q22-20 44 0l7 35-14 26h-30l-14-26z" /><path d="m139 144-34 20-22 93 19 7 27-65-1 86-20 104h30l22-81 22 81h30l-20-104-1-86 27 65 19-7-22-93-34-20-21 14z" /></g>
          <g className="home-identity-trace" fill="none"><path d="m139 145 21 44 21-44M160 189v90m-30-47 30 18 30-18M139 91h42M115 178l-16 66M205 178l16 66" /><circle cx="160" cy="208" r="7" /></g>
        </svg>
        <div className="home-identity-caption"><span className="home-identity-seal" aria-hidden="true">行</span><div><strong>沿着自己的方向</strong><p>静态身份轮廓 · 二维回退</p><small>正式 3D 形象仍待完成；你的路径与记录不受影响。</small></div></div>
      </section>
      <section className="home-current-focus" aria-label="当前重点">
        <span className="brand">Current focus / 当前重点</span>
        {focused ? <><h2>{focused.goal.title}</h2>{next ? <><p className="home-focus-stage">{next.stageTitle} <span>／ {nodeKinds[next.node.type]}</span></p>
          <h3>{next.node.title}</h3><p className="home-focus-effort">{next.node.estimatedMinutes == null ? "预计投入待明确" : `预计投入 ${next.node.estimatedMinutes} 分钟`}</p>
          <div className="home-focus-criteria"><h4>完成依据</h4><p>{next.node.completionCriteria || "完成依据待明确，请先核对路径。"}</p></div>
          {next.completion === "needs_review" ? <Status tone="warning">待复核：节点名称、类型或完成依据已变化，旧确认不代表当前依据已满足。</Status> : null}
          {blockedNames.length ? <div className="home-focus-dependencies"><h4>仍待核对的前置条件</h4><ul>{blockedNames.map((name, index) => <li key={next.blockedBy[index]}>{name}</li>)}</ul>
            <p>这里优先提醒你复核，不是绕过前置条件的建议。</p></div> : <p className="home-focus-dependencies">{next.node.dependencyIds.length ? "当前前置节点已由你自确认，仍可在完整路径核对关联。" : "没有前置条件，可从这一步开始。"}</p>}
          <a className="bp-button primary" href={pathHref(focused.goal.id, next.node.id)}>查看这一步 <span aria-hidden="true">→</span></a>
        </> : <>
          {focused.awaitingPlan ? <><h3>等待规划</h3><p>这个目标还没有正式节点。先核对阶段、行动与完成依据，再由你确认路径。</p><a className="bp-button primary" href="/blueprint/edit">编辑并审阅路径</a></>
            : <><h3>{focused.allSelfConfirmed ? "所有节点已由你自确认" : "先核对完整路径"}</h3>
              <p>{focused.allSelfConfirmed ? "这是对节点的自我判断，不等于目标达成或能力认证。你仍可回看依据、记录成果或重新打开节点。" : "当前没有前置条件已满足的下一步。请查看完整路径中的前置关系与待复核状态。"}</p></>}
          <a className="bp-button" href={pathHref(focused.goal.id)}>查看完整路径</a>
        </>}</> : <><h2>还没有正式目标</h2><p>从想实现的改变开始。目标定义与正式路径分别确认，首页不会自动替你生成计划。</p>
          <a className="bp-button primary" href="/goals/new">定义我的第一个目标</a><a className="home-secondary-link" href="/blueprint/edit">已有想法？手动编辑并审阅路径</a></>}
      </section>
    </div>
    <section className="home-recent-evidence" aria-label="最近成果">
      <div className="home-section-heading"><div><span className="brand">Your trail / 留下的真实变化</span><h2>最近成果</h2></div><a href="/progress">打开成长档案 <span aria-hidden="true">↗</span></a></div>
      {!evidence.ok ? <Status tone="warning">暂时无法读取成果，这不表示记录为空。可打开成长档案重新读取；当前路径仍可查看。</Status>
        : evidence.value.length === 0 ? <div className="home-evidence-empty"><p>还没有成果记录。一次尝试、一处发现，都值得留下。</p><a href="/progress">记录一次真实的收获</a></div>
          : <div className="home-evidence-grid">{evidence.value.slice(0, 3).map(record => {
        const active = goals.some(item => item.goal.id === record.context.goalId && item.nodes.some(node => node.node.id === record.context.nodeId));
        return <article key={record.id} className="home-evidence-card"><time dateTime={record.createdAt}>{new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(record.createdAt))} · 北京时间</time>
          <h3>{record.context.nodeTitle}</h3><p className="home-evidence-context">{record.context.goalTitle} / {record.context.stageTitle} · 路径版本 {record.context.blueprintVersion}</p>
          <p className="home-evidence-text">{record.text.length > 180 ? `${record.text.slice(0, 180)}…` : record.text}</p>
          {active ? <a href={pathHref(record.context.goalId, record.context.nodeId)}>查看当前节点 <span aria-hidden="true">→</span></a> : <span className="home-evidence-historical">历史记录 · 节点已不在原目标路径中</span>}
        </article>;
      })}</div>}
    </section>
  </div>;
}
