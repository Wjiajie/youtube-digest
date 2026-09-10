import { Panel, Status } from "@blueprint/ui";
import type { ClearedEvidenceView } from "./resource-view";

/** A receipt only: never reconstruct provider content from official path history. */
export function ClearedEvidence({ receipt }: { receipt: ClearedEvidenceView }) {
  return <div className="resource-workbench resource-evidence-notice"><Panel className="resource-card"><p className="resource-eyebrow">EVIDENCE / {receipt.clearReason === "expired" ? "EXPIRED" : "CLEARED"}</p><h1>{receipt.clearReason === "expired" ? "资源证据已到期清除" : "资源证据已清除"}</h1>
    <Status tone="neutral">这条检索链的材料与核验正文已清除，不能恢复或继续匹配。未确认的资源变更已拒绝。</Status>
    <p>正式路径、资源绑定、笔记与学习历史仍保留。旧运行编号只用于恢复清除回执，不会再次执行。</p>
    <p className="resource-muted">清除时间：<time dateTime={receipt.clearedAt}>{new Date(receipt.clearedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</time><br />蓝图来源 v{receipt.blueprintVersion}</p>
    <nav className="resource-actions" aria-label="清除后导航"><a className="bp-button" href="/paths">查看当前路径</a>
      <a className="bp-button" href={`/resources/nodes/${receipt.nodeId}`}>查看节点资源记录</a>
      {receipt.sourceRunId && <a className="bp-button" href={`/resources/${receipt.sourceRunId}`}>查看来源回执</a>}
      {receipt.childId && <a className="bp-button" href={`/resources/${receipt.childId}`}>查看后续回执</a>}</nav>
    {!!receipt.adoptions?.length && <section><h2>采用回执</h2><p>最近 20 条，仅保留记录入口。</p><ol>{receipt.adoptions.map((item, index) => <li key={item.id}>
      <a href={`/resources/adoptions/${item.id}`}>采用回执 {index + 1}</a></li>)}</ol></section>}
    <p className="resource-muted">这是应用数据库内的证据清理，不是注销账号或撤回已发送给提供方的材料。其他已打开页面需重新读取；备份与处理商删除尚待单独验收。</p>
  </Panel></div>;
}
