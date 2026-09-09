import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readGoalBrief } from "@/lib/goal-briefs";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { saveGoalBriefAction, readGoalBriefAction } from "../../goal-brief-actions";
import { GoalBriefEditor } from "../goal-brief-editor";
import "../goal-brief.css";

export const metadata = { title: "目标定义工作台 · Blueprint" };

export default async function GoalBriefPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }>;
}) {
  const { id } = await params;
  if (id !== "new" && !z.uuid().safeParse(id).success) notFound();
  const creating = (await searchParams).draft === "1";
  const path = `/goals/${id}${creating ? "?draft=1" : ""}`;
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (id === "new") redirect(`/goals/${randomUUID()}?draft=1`);
  const { actor, client } = identity.value;
  const result = await readGoalBrief(client, actor, id).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  const canCreate = !result.ok && result.code === "not_found" && creating && actor.client === "web";
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell brief-shell">
    <nav className="brief-nav" aria-label="目标定义导航"><Link href="/goals" prefetch={false} className="bp-button">← 我的目标定义</Link><span className="brand">Blueprint / Direction</span></nav>
    <header className="brief-intro"><div><p className="brand">先看清方向</p><h1>让目标有据可循</h1><p className="subtle">不必一次想清所有事，先从你希望发生的改变开始。</p></div><span className="brief-emblem" aria-hidden="true">志<span>DIRECTION</span></span></header>
    {result.ok || canCreate ? <GoalBriefEditor accountId={actor.userId} id={id} initial={result.ok ? result.value : null}
      saveAction={saveGoalBriefAction.bind(null, actor.userId)} reloadAction={readGoalBriefAction.bind(null, actor.userId, id)} />
      : <Panel className="brief-card"><Status tone="warning">{result.code === "not_found" ? "没有找到可访问的目标定义，不会用空白草稿替代已有数据。" : "暂时无法读取目标定义，已有数据与本机恢复内容没有删除。"}</Status><a className="bp-button" href={path}>重新读取</a></Panel>}
    <p className="brief-footnote subtle">未保存的文字只保留在当前浏览器。请收藏本页以找回本机草稿；保存到云端后，可从“我的目标定义”跨设备继续。</p>
  </main></AccountThemeShell>;
}
