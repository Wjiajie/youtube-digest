import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createPlanningRunAccess } from "@/lib/agent/planning-access";
import { readGoalBrief } from "@/lib/goal-briefs";
import { AccountThemeShell } from "../../../account-theme-shell";
import { AuthUnavailable } from "../../../auth-unavailable";
import "../../goal-brief.css";

export const metadata = { title: "目标规划记录 · Blueprint" };
export default async function PlanningListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id } = await params; const query = await searchParams; const page = Number(query.page ?? "1");
  if (!z.uuid().safeParse(id).success || !Number.isSafeInteger(page) || page < 1 || page > 50_001) notFound();
  const path = `/goals/${id}/planning?page=${page}`; const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value;
  const brief = await readGoalBrief(client, actor, id).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  const records = brief.ok ? await createPlanningRunAccess(client, actor).list(id, (page - 1) * 20) : null;
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell brief-shell">
    <nav className="brief-nav"><Link href={`/goals/${id}`} prefetch={false} className="bp-button">← 目标定义</Link><span className="brand">Blueprint / History</span></nav>
    <header className="brief-intro"><div><p className="brand">让建议有迹可循</p><h1>规划记录</h1><p>{brief.ok ? brief.value.content.outcome : "无法读取目标定义"}</p></div><span className="brief-emblem" aria-hidden="true">策<span>PLANNING</span></span></header>
    {records?.ok ? <><p className="subtle">按创建时间排列。进入记录核对当前状态，不会重新生成路径。</p>
      {records.value.runs.length ? <div className="brief-list">{records.value.runs.map((run, index) => <Panel key={run.id} className="brief-card"><p className="brand">PLANNING RECORD</p><h2>规划记录 {(page - 1) * 20 + index + 1}</h2><p><time dateTime={run.createdAt}>{new Date(run.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC</time></p><Link prefetch={false} href={`/planning/${run.id}`} className="bp-button">查看这次规划</Link></Panel>)}</div>
        : <Panel className="brief-card brief-empty"><h2>还没有规划记录</h2><p>目标定义已保留。正式生成入口尚未开放；这里不会用示例冒充你的建议。</p></Panel>}
      <nav className="brief-pagination" aria-label="规划记录分页">{page > 1 && <Link prefetch={false} className="bp-button" href={`/goals/${id}/planning?page=${page - 1}`}>上一页</Link>}<span>第 {page} 页</span>{records.value.hasMore && <Link prefetch={false} className="bp-button" href={`/goals/${id}/planning?page=${page + 1}`}>下一页</Link>}</nav>
    </> : <Panel className="brief-card"><Status tone="warning">没有找到可访问的记录，或服务暂时不可用。不会创建空白规划替代已有数据。</Status><a href={path} className="bp-button">重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
