import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { listGoalBriefs } from "@/lib/goal-briefs";
import { AccountThemeShell } from "../account-theme-shell";
import { AuthUnavailable } from "../auth-unavailable";
import "./goal-brief.css";

export const metadata = { title: "我的目标定义 · Blueprint" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/goals" />;
    redirect("/login?next=%2Fgoals");
  }
  const query = await searchParams;
  const requested = Number(query.page ?? 1);
  const page = Number.isSafeInteger(requested) && requested > 0 && requested <= 20_001 ? requested : 1;
  const { actor, client } = identity.value;
  const result = await listGoalBriefs(client, actor, (page - 1) * 50).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell brief-shell">
    <nav className="brief-nav" aria-label="目标定义导航"><Link href="/" className="bp-button">← 返回蓝图</Link><span className="brand">Blueprint / Direction</span></nav>
    <header className="brief-intro"><div><p className="brand">从想要，到清晰</p><h1>我的目标定义</h1><p className="subtle">把值得投入的方向留在这里，慢慢校准，再迈出下一步。</p></div><span className="brief-emblem" aria-hidden="true">志<span>DIRECTION</span></span></header>
    <div className="brief-list-heading"><p className="subtle">仅自己可见 · 定义不是正式目标路径</p><Link href="/goals/new" prefetch={false} className="bp-button primary">定义一个新目标</Link></div>
    {!result.ok ? <Panel className="brief-card"><Status tone="warning">暂时无法读取目标定义，已有数据没有删除。</Status><a className="bp-button" href="/goals">重新读取</a></Panel>
      : result.value.briefs.length ? <><div className="brief-list">{result.value.briefs.map(brief => <Panel key={brief.id} className="brief-card brief-list-card">
        <div className="brand">{brief.status === "confirmed" ? "定义已确认" : "定义草稿"} / REV {brief.revision}</div>
        <h2><Link href={`/goals/${brief.id}`} prefetch={false}>{brief.content.outcome.trim() || "尚未命名的方向"}</Link></h2>
        <p>{brief.content.successCriteria || "还没有写下成功的依据，可以从这里继续。"}</p>
        <div className="brief-list-meta"><span>{brief.content.weeklyMinutes === null ? "投入时间待补充" : `每周 ${brief.content.weeklyMinutes} 分钟`}</span><span>{brief.content.targetDate ?? "期限未指定"}</span></div>
        <Link href={`/goals/${brief.id}`} prefetch={false} className="brief-open">继续核对 →</Link>
      </Panel>)}</div><nav className="brief-pagination" aria-label="定义列表分页">
        {page > 1 ? <Link className="bp-button" href={`/goals?page=${page - 1}`}>上一页</Link> : null}<span>第 {page} 页</span>
        {result.value.hasMore && page < 20_001 ? <Link className="bp-button" href={`/goals?page=${page + 1}`}>下一页</Link> : null}
      </nav></> : <Panel className="brief-card brief-empty"><h2>{page > 1 ? "这一页还没有定义" : "你的下一个方向，从一句话开始"}</h2>
        <p className="subtle">可以先留下不完整的想法。填写起点、可投入时间与成功依据后，再明确确认。</p>{page > 1 ? <Link href="/goals">回到第一页</Link> : null}</Panel>}
    <p className="brief-footnote subtle">Agent 对话与路径规划尚未接通。这里保存的定义不会自动创建正式路径、推荐视频或消耗模型额度。</p>
  </main></AccountThemeShell>;
}
