import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createClarificationWorkspace } from "@/lib/agent/clarification-workspace";
import { clarificationConfiguration } from "@/lib/agent/clarification-runtime";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { readClarificationAction, readClarificationTurnAction, cancelClarificationTurnAction,
  editClarificationAction, saveClarificationAction } from "../../clarification-actions";
import { ClarificationWorkbench } from "../clarification-workbench";
import "../../goals/goal-brief.css";
import "../clarification-workbench.css";

export const metadata = { title: "目标澄清工作台 · Blueprint" };
export default async function ClarificationPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ turn?: string }>;
}) {
  const { id } = await params, query = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const turn = z.uuid().safeParse(query.turn);
  const path = `/clarification/${id}${turn.success ? `?turn=${turn.data}` : ""}`;
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value;
  const result = await createClarificationWorkspace(client, actor).read(id);
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell brief-shell clarification-shell">
    <nav className="brief-nav" aria-label="目标澄清导航"><Link href="/goals" prefetch={false} className="bp-button">← 我的目标定义</Link><Link href="/">返回蓝图</Link></nav>
    {result.ok ? <ClarificationWorkbench accountId={actor.userId} initial={result.value} enabled={clarificationConfiguration() !== null}
      pendingTurnId={turn.success ? turn.data : null} readAction={readClarificationAction.bind(null, actor.userId, id)}
      readTurnAction={readClarificationTurnAction.bind(null, actor.userId, id)} cancelAction={cancelClarificationTurnAction.bind(null, actor.userId, id)}
      editAction={editClarificationAction.bind(null, actor.userId, id)} saveAction={saveClarificationAction.bind(null, actor.userId, id)} />
      : <Panel className="brief-card"><h1>暂时无法打开澄清记录</h1><Status tone="warning">{result.code === "not_found"
        ? "记录可能尚未建立，或当前账号无法访问。不会自动创建替代会话或调用模型。" : "会话暂时无法读取。已有云端内容没有删除，不会自动重试生成。"}</Status>
        <a className="bp-button" href={path}>重新读取本次会话</a><Link className="bp-button" href="/goals">返回目标定义</Link></Panel>}
  </main></AccountThemeShell>;
}
