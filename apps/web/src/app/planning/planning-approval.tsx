"use client";

import { useRef, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";
import type { PlanningRun } from "@/lib/agent/planning-run";
import type { PlanningApprovalRecord, PlanningApprovalResponse } from "@/lib/agent/planning-approval";

export type ApprovalActions = {
  read: () => Promise<PlanningApprovalResponse>;
  prepare: () => Promise<PlanningApprovalResponse>;
  reject: () => Promise<PlanningApprovalResponse>;
  apply: (proposalId: string, baseVersion: number) => Promise<PlanningApprovalResponse>;
};
type Props = { accountId: string; runId: string; runStatus: PlanningRun["status"]; initial: PlanningApprovalResponse;
  actions: ApprovalActions; onIdentityLost?: () => void };
const inaccessible = (response: PlanningApprovalResponse) => !response.ok && ["unauthenticated", "forbidden", "not_found"].includes(response.code);

export function PlanningApproval(props: Props) {
  return <ApprovalSession key={`${props.accountId}:${props.runId}`} {...props} />;
}

function ApprovalSession({ accountId, runId, runStatus, initial, actions, onIdentityLost }: Props) {
  const matches = (value: PlanningApprovalRecord) => value.ownerId === accountId && value.runId === runId;
  const [record, setRecord] = useState(initial.ok && matches(initial.value) ? initial.value : null);
  const [hidden, setHidden] = useState(inaccessible(initial) || (initial.ok && !matches(initial.value)));
  const [uncertain, setUncertain] = useState(!initial.ok);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const locked = useRef(false);
  async function perform(action: () => Promise<PlanningApprovalResponse>) {
    if (locked.current || hidden) return;
    locked.current = true; setBusy(true); setMessage("");
    try {
      const response = await action();
      if (inaccessible(response) || (response.ok && !matches(response.value))) {
        setHidden(true); setRecord(null); onIdentityLost?.(); return;
      }
      if (!response.ok) {
        setUncertain(true);
        setMessage(response.code === "version_conflict" ? "目标定义或蓝图已变化，不能继续确认旧建议。请核对状态后回到目标定义。"
          : "尚未确认操作结果。请先核对提案状态，不会自动重复提交。"); return;
      }
      setRecord(response.value); setUncertain(false); setMessage("已核对云端提案状态。");
    } catch { setUncertain(true); setMessage("网络中断，操作可能已经完成。请先核对提案状态，不会自动重复提交。"); }
    finally { locked.current = false; setBusy(false); }
  }
  if (hidden) return <Panel className="brief-card"><Status tone="warning">当前身份无法访问这份提案，私人内容已隐藏。请重新登录后打开记录。</Status></Panel>;
  const proposal = record?.proposal;
  const current = record?.sourceCurrent && runStatus === "ready";
  const disabled = busy || uncertain;
  return <Panel className="brief-card planning-approval">
    <p className="brand">YOUR DECISION</p><h2>由你决定是否采用</h2>
    <Status tone={busy ? "progress" : uncertain ? "warning" : "neutral"}>{busy ? "正在核对云端提案…" : message || (uncertain ? "暂时无法确认提案状态，请先核对。" : "")}</Status>
    {proposal?.status === "applied" ? <><h3>已写入正式蓝图 v{proposal.appliedVersion}</h3><p>这是本次确认的版本。节点仍待你实践和检查，不代表已经完成或掌握。</p><a href="/paths" className="bp-button">查看正式路径</a></>
      : proposal?.status === "rejected" ? <><h3>已拒绝这份提案</h3><p>正式路径未因此改变。此运行不会自动重新准备提案或重新生成。</p></>
      : <>
        {!current && <Status tone="warning">来源不是当前可确认状态。请回到目标定义重新核对，旧建议不会自动套用到新版本。</Status>}
        {proposal ? <><p>提案已准备，尚未写入正式路径。确认将以以上建议更新蓝图 v{proposal.baseVersion}；原有目标保留。</p>
          <div className="brief-actions"><Button disabled={disabled || !current} onClick={() => void perform(() => actions.apply(proposal.id, proposal.baseVersion))}>确认并应用</Button>
            <Button disabled={disabled} onClick={() => void perform(actions.reject)}>拒绝这份提案</Button></div></>
          : <><p>先准备一份与本次规划绑定的提案，再由你单独确认。准备不会修改正式路径。</p>
            <Button disabled={disabled || !current} onClick={() => void perform(actions.prepare)}>准备确认提案</Button></>}
      </>}
    <div className="brief-actions"><Button disabled={busy} onClick={() => void perform(actions.read)}>核对提案状态</Button></div>
  </Panel>;
}
