import Link from "next/link";
import { canonicalYouTubeUrl, type GoalProgressView } from "@blueprint/domain";
import "./path-views.css";

const kinds = { learn: { label: "学习", symbol: "◇" }, practice: { label: "实践", symbol: "△" },
  checkpoint: { label: "检查点", symbol: "◎" }, reflection: { label: "复盘", symbol: "↺" } };
type NodeView = GoalProgressView["nodes"][number];
function statusLabel(view: NodeView) {
  if (view.completion === "needs_review") return "旧自评待复核";
  if (view.completion === "self_confirmed") return "自我确认完成";
  return view.status?.status === "in_progress" ? "进行中" : "尚未开始";
}

export function PathsOverview({ goals }: { goals: GoalProgressView[] }) {
  return <section className="formal-paths" aria-label="全部正式路径">
    <header className="path-heading"><p className="path-eyebrow">Blueprint / Paths</p><h1>全部正式路径</h1>
      <p>从一个目标进入完整路径，核对下一步与完成依据。</p>
      <Link className="bp-button" href="/blueprint/edit">编辑路径提案</Link></header>
    {goals.length ? <div className="path-goal-grid">{goals.map(view => <article className="path-goal-card" key={view.goal.id}>
      <p className="path-eyebrow">{view.nodes.length} 个节点 · {view.goal.stages.length} 个阶段</p>
      <h2><Link href={`/paths/${encodeURIComponent(view.goal.id)}`}>{view.goal.title}</Link></h2>
      {view.goal.description ? <p>{view.goal.description}</p> : null}
      <p>{view.awaitingPlan ? "等待规划：这条路径还没有节点。" : view.next
        ? `${view.next.completion === "needs_review" ? "先复核" : "下一步"}：${view.next.node.title}`
        : view.allSelfConfirmed ? "全部节点已自我确认，不代表目标已经达成。" : "查看完整路径，核对自己的进展。"}</p>
      <p className="path-muted">{view.confirmedCheckpoints} 个检查点已自我确认{view.needsReviewCount ? ` · ${view.needsReviewCount} 个节点待复核` : ""}</p>
    </article>)}</div> : <div className="path-empty"><h2>还没有正式路径</h2><p>可以先梳理目标定义，再通过路径提案建立节点。</p><Link className="bp-button" href="/goals">梳理目标定义</Link></div>}
  </section>;
}

export function GoalPathView({ goal, selectedNodeId }: { goal: GoalProgressView; selectedNodeId?: string }) {
  const selected = goal.nodes.find(view => view.node.id === selectedNodeId);
  const nodeNames = new Map(goal.nodes.map(view => [view.node.id, view.node.title]));
  const stages = goal.goal.stages;
  return <section className="formal-paths" aria-label="正式目标路径">
    <nav className="path-navigation" aria-label="路径导航"><Link className="bp-button" href="/paths">← 全部正式路径</Link><Link className="bp-button" href="/blueprint/edit">编辑路径提案</Link></nav>
    <header className="path-heading"><p className="path-eyebrow">Blueprint / Your Path</p><h1>{goal.goal.title}</h1>
      {goal.goal.description ? <p className="path-preserve">{goal.goal.description}</p> : null}
      <p className="path-muted">{goal.nodes.length} 个节点 · {goal.confirmedCheckpoints} 个检查点已自我确认。自评不代表系统认证掌握。</p>
    </header>
    {selectedNodeId && !selected ? <p className="path-notice" role="status">指定节点不在当前路径中，可能已调整或归档。下方仍显示完整路径。</p> : null}
    {goal.next ? <aside className="path-next" aria-label="当前下一步"><p className="path-eyebrow">{goal.next.completion === "needs_review" ? "先核对变化" : "当前下一步"}</p>
      <h2><a href={`#node-${goal.next.node.id}`}>{goal.next.node.title}</a></h2>
      <p>{goal.next.completion === "needs_review" ? "节点名称、类型或完成依据已变化，请重新核对旧自评。前置关系见下方完整路径。" : "按当前前置关系与自评状态，先关注这一步。"}</p>
    </aside> : goal.awaitingPlan ? <div className="path-empty"><h2>等待规划</h2><p>这条路径还没有节点。通过编辑路径提案补充，并审阅确认后生效。</p></div>
      : <div className="path-notice"><h2>{goal.allSelfConfirmed ? "所有节点已自我确认" : "先核对前置关系"}</h2><p>{goal.allSelfConfirmed ? "这是你对节点的自评，不代表目标已经达成。仍可回看依据或重新打开节点。" : "暂无前置条件满足的下一步，请沿下方依赖关系核对。"}</p></div>}
    <div className="path-tools"><Link className="bp-button" href="/progress/status">确认节点状态</Link><Link className="bp-button" href="/progress">记录成果</Link><Link className="bp-button" href="/progress/notes">视频笔记</Link><Link className="bp-button" href="/progress/resume">继续学习</Link><p className="path-muted">进入后选择对应节点，再核对并确认。</p></div>
    <ol className="path-stages" aria-label="路径阶段">{stages.map((stage, stageIndex) => <li key={stage.id}><section>
      <p className="path-eyebrow">阶段 {String(stageIndex + 1).padStart(2, "0")}</p><h2>{stage.title}</h2>
      {stage.nodes.length ? <ol className="path-nodes" aria-label="完整节点路径">{goal.nodes.filter(view => view.stageId === stage.id).map(view => {
        const { node } = view; const kind = kinds[node.type];
        return <li key={node.id}><article id={`node-${node.id}`} tabIndex={-1} aria-current={selected?.node.id === node.id ? "location" : undefined}
          className={`path-node${goal.next?.node.id === node.id ? " path-node-next" : ""}${selected?.node.id === node.id ? " path-node-selected" : ""}`}>
          <div className="path-node-top"><span className="path-kind"><span aria-hidden="true">{kind.symbol}</span>{kind.label}</span>
            <span className={`path-state path-state-${view.completion}`}>{statusLabel(view)}</span></div>
          <h3>{node.title}</h3>
          {selected?.node.id === node.id ? <p className="path-selected-label">正在查看指定节点</p> : null}
          {goal.next?.node.id === node.id ? <p className="path-next-label">{view.completion === "needs_review" ? "当前待复核" : "当前下一步"}</p> : null}
          {node.description ? <p className="path-preserve">{node.description}</p> : null}
          <dl className="path-node-facts"><div><dt>预计投入</dt><dd>{node.estimatedMinutes == null ? "投入待明确" : `${node.estimatedMinutes} 分钟`}</dd></div>
            <div><dt>完成依据</dt><dd className="path-preserve">{node.completionCriteria || "完成依据待明确"}</dd></div></dl>
          {view.completion === "needs_review" ? <p className="path-notice">旧确认依据与当前节点不一致，请重新核对；这不会自动撤销旧历史。</p> : null}
          <div className="path-dependencies"><h4>前置关系</h4>{node.dependencyIds.length ? <><ul>{node.dependencyIds.map(id => <li key={id}>
            <a href={`#node-${id}`}>{nodeNames.get(id) ?? "当前路径中未找到的前置节点"}</a>
            {view.blockedBy.includes(id) ? <span className="path-muted"> · 尚待自我确认</span> : <span className="path-muted"> · 已自我确认</span>}
          </li>)}</ul>{view.blockedBy.length ? <p className="path-muted">前置节点尚待自我确认，请先核对；不是对能力的系统判断。</p> : null}</> : <p className="path-muted">没有前置节点</p>}</div>
          <div className="path-resources"><h4>可选资源</h4>{node.resources.length ? <ul>{node.resources.map((resource, index) => {
            const canonical = canonicalYouTubeUrl(resource.url);
            return <li key={resource.id}>{resource.kind === "youtube_video" && canonical?.externalId === resource.externalId
              ? <><a className="path-resource-link" href={canonical.url} target="_blank" rel="noopener noreferrer">在 YouTube 打开视频 {index + 1}<span className="path-muted"> · 新标签页</span></a>
                <Link className="bp-button" prefetch={false} href={`/learn/${resource.id}`}>阅读视频 {index + 1} 的原始字幕</Link></>
              : <p className="path-muted">资源链接暂不可用，请在路径提案中核对。</p>}</li>;
          })}</ul> : <p className="path-muted">未绑定视频，仍可完成这一步的学习或实践。</p>}
          {node.type === "learn" ? <Link className="bp-button" prefetch={false} href={`/resources/nodes/${node.id}`}>查找与审阅学习资源</Link> : null}</div>
        </article></li>;
      })}</ol> : <p className="path-empty">这个阶段还没有节点，等待补充规划。</p>}
    </section></li>)}</ol>
  </section>;
}
