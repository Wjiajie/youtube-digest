"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";
import type { ClearedEvidenceView, ResourceRunReviewProps } from "./resource-view";
import { ClearedEvidence } from "./cleared-evidence";

/** Legacy content has no trusted lifetime. Offer deletion without ever fetching/displaying its body. */
export function UnmanagedEvidence({ accountId, runId, clearAction }: {
  accountId: string; runId: string; clearAction: NonNullable<ResourceRunReviewProps["clearAction"]>;
}) {
  const identity = useRef(`${accountId}:${runId}`), mounted = useRef(true), locked = useRef(false);
  const [confirm, setConfirm] = useState(false), [pending, setPending] = useState(false), [attempted, setAttempted] = useState(false);
  const [hidden, setHidden] = useState(false), [receipt, setReceipt] = useState<ClearedEvidenceView | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function clear() {
    if (locked.current || hidden || !confirm) return;
    locked.current = true; setPending(true); setAttempted(true);
    try {
      const result = await clearAction(); if (!mounted.current) return;
      if (!result.ok) { if (["unauthenticated", "forbidden", "not_found"].includes(result.code)) setHidden(true); return; }
      if (result.value.id !== runId) { setHidden(true); return; }
      if (result.value.status === "cleared") setReceipt(result.value);
    } catch { /* Reload reconciles an uncertain outcome, without another deletion request. */ }
    finally { if (mounted.current) setPending(false); }
  }
  if (hidden || identity.current !== `${accountId}:${runId}`) return <Panel><Status tone="warning">身份已变化，请重新登录后打开记录。</Status><a href="/login">重新登录</a></Panel>;
  if (receipt) return <ClearedEvidence receipt={receipt} />;
  return <div className="resource-workbench resource-evidence-notice"><Panel className="resource-card">
    <h1>无法验证证据期限</h1><Status tone="warning">此记录缺少可使用的证据期限，旧正文已停止展示和处理。这不表示内容已从数据库清除。</Status>
    <p>可以明确清除整条检索链；正式路径、已确认的资源绑定与学习记录保持不变。</p>
    {attempted ? <Status tone={pending ? "progress" : "warning"}>{pending ? "正在清除…" : "结果尚未确认，请重新读取本页。不会自动再次清除。"}</Status>
      : confirm ? <section><h2>确认清除整条检索链？</h2><p>检索、字幕、匹配与采用核验正文将不可恢复地清除；未确认资源变更会被拒绝。提供方、离线副本与备份不在本次删除范围。</p>
        <Button onClick={() => void clear()}>确认清除证据</Button><Button onClick={() => setConfirm(false)}>保留证据</Button></section>
      : <Button onClick={() => setConfirm(true)}>清除这条检索链的证据</Button>}
    <nav className="resource-actions"><a className="bp-button" href={`/resources/${runId}`}>重新读取</a><a className="bp-button" href="/paths">返回路径</a></nav>
  </Panel></div>;
}
