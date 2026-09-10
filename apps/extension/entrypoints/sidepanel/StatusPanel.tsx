import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { ApplicationResult, NodeStatusRecord, NodeStatusWorkspace } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";
import { NodeStatusWorkspacePanel } from "@blueprint/ui/node-status-workspace";
import "@blueprint/ui/node-status-workspace.css";

export function StatusPanel({ ownerId }: { ownerId: string }) {
  return <AccountAssessment key={ownerId} ownerId={ownerId} />;
}

function AccountAssessment({ ownerId }: { ownerId: string }) {
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [initial, setInitial] = useState<NodeStatusWorkspace | null>(null);
  const [loading, setLoading] = useState(false), [failure, setFailure] = useState(false);
  useEffect(() => {
    if (!started) return;
    let active = true; setLoading(true); setFailure(false);
    void browser.runtime.sendMessage({ type: "LOAD_NODE_STATUS", ownerId }).then((result: ApplicationResult<NodeStatusWorkspace>) => {
      if (!active) return;
      if (result.ok) setInitial(result.value); else setFailure(true);
    }).catch(() => { if (active) setFailure(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, started, attempt]);

  return <div className="extension-assessment">
    <Button className="web-link" aria-expanded={open} aria-controls="extension-assessment-content" onClick={() => { setOpen(!open); setStarted(true); }}>{open ? "收起节点状态" : "核对节点状态"}</Button>
    <section id="extension-assessment-content" aria-label="节点状态确认" hidden={!open}>
      <p className="muted">先选择要核对的节点，再根据完成依据作出自评。切换视频不会改选节点，也不会自动确认完成。</p>
      {loading ? <Status>正在读取私人路径与状态…</Status> : null}
      {failure ? <Panel><Status tone="warning">暂时无法读取节点状态。原选择和待核对请求仍保留，请检查网络与账号后重试。</Status>
        <Button disabled={loading} onClick={() => setAttempt(value => value + 1)}>重新读取节点状态</Button></Panel> : null}
      {initial ? <NodeStatusWorkspacePanel accountId={ownerId} initial={initial}
        saveAction={input => browser.runtime.sendMessage({ type: "CONFIRM_NODE_STATUS", ownerId, input }) as Promise<ApplicationResult<NodeStatusRecord>>}
        reloadAction={() => browser.runtime.sendMessage({ type: "LOAD_NODE_STATUS", ownerId }) as Promise<ApplicationResult<NodeStatusWorkspace>>} /> : null}
    </section>
  </div>;
}
