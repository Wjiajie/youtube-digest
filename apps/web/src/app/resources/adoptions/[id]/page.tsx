import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createResourceAdoptionWorkspace } from "@/lib/agent/resource-adoption-workspace";
import { AccountThemeShell } from "../../../account-theme-shell";
import { AuthUnavailable } from "../../../auth-unavailable";
import { readResourceAdoptionAction, cancelResourceAdoptionAction, rejectResourceAdoptionAction, applyResourceAdoptionAction } from "../../../resource-adoption-actions";
import { AdoptionReview } from "../../adoption-review";
import "../../resource-workbench.css";
export const metadata = { title: "资源采用确认 · Blueprint" };
export default async function ResourceAdoptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const path = `/resources/adoptions/${id}`, identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value, result = await createResourceAdoptionWorkspace(client, actor).read(id);
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell resource-shell">
    {result.ok ? <AdoptionReview key={`${actor.userId}:${id}`} accountId={actor.userId} initial={result.value}
      readAction={readResourceAdoptionAction.bind(null, actor.userId, id)} cancelAction={cancelResourceAdoptionAction.bind(null, actor.userId, id)}
      rejectAction={rejectResourceAdoptionAction.bind(null, actor.userId, id)} applyAction={applyResourceAdoptionAction.bind(null, actor.userId, id)} />
      : <Panel><h1>暂时无法打开采用记录</h1><Status tone="warning">记录可能尚未创建、账号不匹配或服务暂时不可用。没有自动重复核验，请先核对原页面。</Status><a href={path}>重新读取</a><a href="/paths">返回路径</a></Panel>}
  </main></AccountThemeShell>;
}
