import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readGoalBrief } from "@/lib/goal-briefs";
import { createClarificationAccess } from "@/lib/agent/clarification-access";
import { clarificationConfiguration } from "@/lib/agent/clarification-runtime";
import { AccountThemeShell } from "../../../account-theme-shell";
import { AuthUnavailable } from "../../../auth-unavailable";
import { startClarificationAction } from "../../../clarification-actions";
import { ClarificationStart } from "../../../clarification/clarification-start";
import "../../goal-brief.css";

export const metadata = { title: "澄清你的目标 · Blueprint" };
export default async function ClarificationHistoryPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; page?: string }>;
}) {
  const { id } = await params, query = await searchParams;
  if (id !== "new" && !z.uuid().safeParse(id).success) notFound();
  const path = `/goals/${id}/clarify${query.new === "1" ? "?new=1" : ""}`;
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (id === "new") redirect(`/goals/${randomUUID()}/clarify?new=1`);
  const { actor, client } = identity.value;
  const source = await readGoalBrief(client, actor, id).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  const creating = !source.ok && source.code === "not_found" && query.new === "1";
  const requested = Number(query.page ?? 1);
  const page = Number.isSafeInteger(requested) && requested > 0 && requested <= 50_001 ? requested : 1;
  const access = createClarificationAccess(client, actor);
  const listed = source.ok ? await access.list(id, (page - 1) * 20) : { ok: true as const, value: { items: [], hasMore: false } };
  const sessions = listed.ok ? await Promise.all(listed.value.items.map(item => access.read(item.id))) : [];
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell brief-shell">
    <nav className="brief-nav" aria-label="澄清导航"><Link className="bp-button" href="/goals" prefetch={false}>← 我的目标定义</Link><Link href="/">返回蓝图</Link></nav>
    <header className="brief-intro"><div><p className="brand">Blueprint / Clarify</p><h1>先找到自己的方向</h1><p className="subtle">不急着要答案。让每一次追问，都更接近你想实现的改变。</p></div><span className="brief-emblem" aria-hidden="true">问<span>CLARIFY</span></span></header>
    {creating || (source.ok && source.value.status === "draft") ? <ClarificationStart key={`${actor.userId}:${id}`} accountId={actor.userId} briefId={id}
      expectedBriefRevision={source.ok ? source.value.revision : 0} enabled={clarificationConfiguration() !== null}
      startAction={startClarificationAction.bind(null, actor.userId)} />
      : <Panel className="brief-card"><Status tone="warning">{source.ok ? "目标定义已经确认。如需再次澄清，请先返回定义并明确进入编辑。" : "暂时无法读取这个目标定义，不会自动创建替代内容。"}</Status>
        {source.ok ? <Link className="bp-button" href={`/goals/${id}`}>核对目标定义</Link> : <a className="bp-button" href={path}>重新读取</a>}</Panel>}
    <section aria-labelledby="clarification-history-title"><h2 id="clarification-history-title">澄清记录</h2>
      {!listed.ok || sessions.some(item => !item.ok) ? <Status tone="warning">部分记录暂时无法读取，请稍后重新核对。</Status> : null}
      {listed.ok && listed.value.items.length === 0 && <p className="subtle">还没有会话记录。开启工作台后，可从这里跨设备继续。</p>}
      <div className="brief-list">{sessions.flatMap((item, index) => item.ok ? [<Panel className="brief-card" key={item.value.id}>
        <p className="brand">{item.value.status === "active" ? "可继续核对" : item.value.status === "closed" ? "已保存结束" : "来源已变化"} · 来源 REV {item.value.briefRevision}</p>
        <h3>{item.value.content.outcome || "尚未命名的方向"}</h3><p className="subtle"><time dateTime={item.value.createdAt}>{new Date(item.value.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）</time></p>
        <Link href={`/clarification/${item.value.id}`} prefetch={false} className="bp-button">打开澄清记录</Link></Panel>]
        : [<a key={listed.ok ? listed.value.items[index].id : index} href={path}>重新读取不可用记录</a>])}</div>
      <nav className="brief-pagination" aria-label="澄清记录分页">{page > 1 && <Link href={`/goals/${id}/clarify?page=${page - 1}`}>上一页</Link>}
        {listed.ok && listed.value.hasMore && <Link href={`/goals/${id}/clarify?page=${page + 1}`}>下一页</Link>}</nav>
    </section>
    <p className="brief-footnote subtle">工作摘要与已保存定义分开保留。只有你明确保存或确认，目标定义才会更新；正式路径还需要后续规划与提案确认。</p>
  </main></AccountThemeShell>;
}
