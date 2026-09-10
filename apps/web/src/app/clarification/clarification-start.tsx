"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel, Status } from "@blueprint/ui";
import type { ClarificationSessionView, ClarificationUiResult } from "./clarification-view";

export type StartClarificationCommand = { sessionId: string; briefId: string; expectedBriefRevision: number };
export function ClarificationStart(props: { accountId: string; briefId: string; expectedBriefRevision: number; enabled: boolean;
  startAction: (input: StartClarificationCommand) => Promise<ClarificationUiResult<ClarificationSessionView>> }) {
  const router = useRouter(), account = useRef(props.accountId), mounted = useRef(true), pending = useRef(false);
  const latestAccount = useRef(props.accountId);
  latestAccount.current = props.accountId;
  const [command, setCommand] = useState<StartClarificationCommand | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "unknown" | "busy" | "conflict" | "identity">("idle");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function start() {
    if (pending.current || account.current !== props.accountId) return;
    const attempt = command ?? { sessionId: crypto.randomUUID(), briefId: props.briefId, expectedBriefRevision: props.expectedBriefRevision };
    pending.current = true; setCommand(attempt); setState("pending");
    try {
      const result = await props.startAction(attempt);
      if (!mounted.current || latestAccount.current !== account.current) return;
      if (result.ok && result.value.id === attempt.sessionId && result.value.briefId === attempt.briefId) router.push(`/clarification/${attempt.sessionId}`);
      else if (!result.ok && ["unauthenticated", "forbidden"].includes(result.code)) setState("identity");
      else if (!result.ok && result.code === "busy") setState("busy");
      else if (!result.ok && ["version_conflict", "not_found", "invalid"].includes(result.code)) setState("conflict");
      else setState("unknown");
    } catch { if (mounted.current && latestAccount.current === account.current) setState("unknown"); }
    finally { pending.current = false; }
  }
  if (state === "identity" || props.accountId !== account.current) return <Status tone="warning">身份已变化，创建操作已隐藏。请重新登录后打开目标定义。</Status>;
  return <Panel className="brief-card">
    <p className="brand">CLARIFY / 01</p><h2>把想法慢慢说清楚</h2>
    <p>从一个问题开始，一起整理方向、起点与可投入的时间。你可以随时修正摘要，决定是否确认。</p>
    <p className="subtle">开启工作台只保存私人草稿，不调用模型，也不创建正式路径。之后每次提交回答可能占用一次澄清机会。</p>
    {!props.enabled && <Status tone="warning">Agent 回答暂未开放；你仍可开启工作台，直接编辑并保存目标摘要。</Status>}
    {state === "idle" && <Button onClick={() => void start()}>开启澄清工作台</Button>}
    {state === "pending" && <Status tone="progress">正在开启工作台，请勿重复提交。</Status>}
    {state === "unknown" && <><Status tone="warning">创建结果尚未确认。可以先读取本次会话，或重试同一创建请求；不会再次调用模型。</Status><Button onClick={() => void start()}>重试本次创建</Button></>}
    {state === "busy" && <Status tone="warning">已有未结束的澄清会话，请从下方历史记录继续。</Status>}
    {state === "conflict" && <Status tone="warning">目标定义已变化或暂不可用，请重新读取后核对；不会覆盖已有内容。</Status>}
    {command && <div className="brief-actions"><a className="bp-button" href={`/clarification/${command.sessionId}`}>读取本次会话</a>
      <a className="bp-button" href={`/goals/${props.briefId}/clarify`}>重新读取澄清历史</a></div>}
  </Panel>;
}
