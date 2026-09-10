import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createPlanningRunAccess } from "@/lib/agent/planning-access";
import { createPlanningApprovalAccess } from "@/lib/agent/planning-approval";
import { readPlanningApprovalAction, preparePlanningApprovalAction, rejectPlanningApprovalAction, applyPlanningApprovalAction } from "../../planning-approval-actions";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { readPlanningRunAction, cancelPlanningRunAction } from "../../planning-actions";
import { PlanningReview } from "../planning-review";
import "../../goals/goal-brief.css";
import "../planning.css";

export const metadata = { title: "规划记录 · Blueprint" };
export default async function PlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const path = `/planning/${id}`; const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value;
  const result = await createPlanningRunAccess(client, actor).read(id);
  const approval = result.ok ? await createPlanningApprovalAccess(client, actor).read(id) : null;
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell brief-shell planning-shell">
    <nav className="brief-nav" aria-label="规划导航"><Link className="bp-button" prefetch={false} href="/goals">← 我的目标定义</Link><span className="brand">Blueprint / Planning</span></nav>
    {result.ok ? <PlanningReview accountId={actor.userId} initial={result.run}
      approval={approval ? { initial: approval, actions: {
        read: readPlanningApprovalAction.bind(null, actor.userId, id), prepare: preparePlanningApprovalAction.bind(null, actor.userId, id),
        reject: rejectPlanningApprovalAction.bind(null, actor.userId, id), apply: applyPlanningApprovalAction.bind(null, actor.userId, id),
      } } : undefined}
      readAction={readPlanningRunAction.bind(null, actor.userId, id)} cancelAction={cancelPlanningRunAction.bind(null, actor.userId, id)} />
      : <Panel className="brief-card"><Status tone="warning">{result.code === "not_found" || result.code === "forbidden" ? "没有找到可访问的规划记录。" : "暂时无法读取规划记录，已有结果没有删除。"}</Status><a className="bp-button" href={path}>重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
