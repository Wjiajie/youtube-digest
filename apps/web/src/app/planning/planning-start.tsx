"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";

type Props = {
  accountId: string; briefId: string; briefRevision: number; blueprintVersion: number;
  confirmed: boolean; enabled: boolean;
  onIdentityLost?: () => void;
};
const statusMessages = {
  pending: "正在提交规划，请勿重复提交。可打开本次规划核对或取消；记录可能尚未创建。",
  ready: "建议已生成，请先审阅。",
  queued: "规划正在等待执行。",
  running: "规划正在生成，可打开记录核对状态或取消。",
  stale: "规划依据已变化，请核对记录并返回目标定义。",
  failed: "这次规划未能完成，正式蓝图没有改变。",
  cancelled: "这次规划已取消，不能据此判断供应商没有产生用量。",
  interrupted: "这次规划已中断，不会自动重跑。",
  unknown: "状态尚未确认，记录可能尚未创建。请先核对本次记录或规划历史，不要重复生成。",
};
const errorMessages = {
  input_too_large: "已有蓝图超出单次规划容量，未调用模型，预留次数已退回；已有内容没有修改。",
  quota_exhausted: "规划次数不足，请先核对账号可用次数。",
  busy: "已有正在处理的规划，请到规划历史核对，不要重复生成。",
  disabled: "生成服务暂未开放，本页不会自动重试。",
  version_conflict: "目标定义或蓝图已变化，请返回目标定义核对最新版本。",
  invalid: "请核对目标定义与开始日期，重新打开目标定义后再明确发起。",
  not_found: "没有找到可访问的目标定义，请返回目标列表核对账号。",
  cancelled: "请求已取消，请核对本次记录；这不代表没有产生用量。",
};

export function PlanningStart(props: Props) {
  return <PlanningStartSession key={`${props.accountId}:${props.briefId}`} {...props} />;
}

function PlanningStartSession(props: Props) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const submitted = useRef(false);
  const activeSession = useRef(true);
  useEffect(() => { activeSession.current = true; return () => { activeSession.current = false; }; }, []);
  const [identityLost, setIdentityLost] = useState(false);
  const [attempt, setAttempt] = useState<{ runId: string; status: keyof typeof statusMessages; error?: keyof typeof errorMessages } | null>(null);
  function hideIdentity() {
    if (!activeSession.current) return;
    setIdentityLost(true); props.onIdentityLost?.();
  }
  async function begin() {
    if (submitted.current || !props.enabled || !props.confirmed || !startDate) return;
    submitted.current = true;
    const runId = crypto.randomUUID();
    setAttempt({ runId, status: "pending" });
    try {
      const response = await fetch("/api/planning/runs", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: props.accountId, runId, briefId: props.briefId,
          expectedBriefRevision: props.briefRevision, expectedBlueprintVersion: props.blueprintVersion, startDate }),
      });
      if (response.status === 401 || response.status === 403) { hideIdentity(); return; }
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "ok" in body && body.ok === false
        && "code" in body && (body.code === "unauthenticated" || body.code === "forbidden")) {
        hideIdentity(); return;
      }
      if (typeof body === "object" && body !== null && "ok" in body && body.ok === false
        && "code" in body && typeof body.code === "string" && Object.hasOwn(errorMessages, body.code)) {
        setAttempt({ runId, status: "unknown", error: body.code as keyof typeof errorMessages }); return;
      }
      if (response.ok && typeof body === "object" && body !== null && "ok" in body && body.ok === true
        && "runId" in body && body.runId === runId && "status" in body && typeof body.status === "string"
        && ["queued", "running", "ready", "stale", "failed", "cancelled", "interrupted"].includes(body.status)) {
        setAttempt({ runId, status: body.status as keyof typeof statusMessages });
      } else setAttempt({ runId, status: "unknown" });
    } catch { setAttempt({ runId, status: "unknown" }); }
  }
  if (identityLost) return <Panel className="brief-card"><Status tone="warning">当前身份无法访问，私人内容与生成操作已隐藏。请重新登录后打开目标定义。</Status><a className="bp-button" href="/login?next=%2Fgoals">重新登录</a></Panel>;
  return <Panel className="brief-card">
    <h2>生成路径建议</h2>
    <p>开始时预留 1 次规划机会。建议不会自动写入正式蓝图，仍需你审阅并明确确认。</p>
    <p>发起后可能产生用量；用量未知不代表免费。</p>
    {!props.enabled ? <Status tone="warning">生成服务暂未开放，不会发起模型调用。</Status> : !props.confirmed && <Status tone="warning">请先确认目标定义，再开始生成建议。</Status>}
    <form onSubmit={event => { event.preventDefault(); void begin(); }}>
      <label>计划开始日期（默认 UTC 今天）<input type="date" required disabled={attempt !== null} value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
      <div className="brief-actions"><Button type="submit" disabled={attempt !== null || !props.enabled || !props.confirmed || !startDate}>生成路径建议</Button></div>
    </form>
    {attempt && <><Status tone={attempt.status === "ready" ? "success" : ["pending", "queued", "running"].includes(attempt.status) ? "progress" : "warning"}>{attempt.error ? errorMessages[attempt.error] : statusMessages[attempt.status]}</Status>
      <a className="bp-button" href={`/planning/${attempt.runId}`} target="_blank" rel="noopener" aria-describedby="planning-new-tab">查看本次规划</a>
      <span id="planning-new-tab">在新标签页打开，保留当前生成请求。</span></>}
    {attempt?.error && <a className="bp-button" href={`/goals/${props.briefId}`}>返回目标定义</a>}
    <div className="brief-actions"><a href={`/goals/${props.briefId}/planning`}>查看规划历史</a></div>
  </Panel>;
}
