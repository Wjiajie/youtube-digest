import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createResourceWorkspace } from "@/lib/agent/resource-workspace";
import { resourceConfiguration } from "@/lib/agent/resource-runtime";
import { resourceAdoptionConfiguration } from "@/lib/agent/resource-adoption-runtime";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { readResourceRunAction, cancelResourceRunAction } from "../../resource-actions";
import { ResourceRunReview } from "../resource-workbench";
import "../resource-workbench.css";

export const metadata = { title: "资源运行记录 · Blueprint" };
export default async function ResourceRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const path = `/resources/${id}`, identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value;
  const result = await createResourceWorkspace(client, actor).read(id);
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell resource-shell">
    <nav aria-label="资源导航"><Link className="bp-button" prefetch={false} href="/paths">← 全部路径</Link></nav>
    {result.ok ? <ResourceRunReview key={`${actor.userId}:${id}`} accountId={actor.userId} initial={result.value} enabled={resourceConfiguration() !== null} adoptionEnabled={resourceAdoptionConfiguration() !== null}
      readAction={readResourceRunAction.bind(null, actor.userId, id)} cancelAction={cancelResourceRunAction.bind(null, actor.userId, id)} />
      : <Panel><h1>暂时无法打开运行记录</h1><Status tone="warning">{result.code === "not_found" || result.code === "forbidden"
        ? "没有找到可访问的记录；新提交可能尚未创建，请核对原页面和账号，不要重复消费。" : "读取服务暂时不可用，没有删除已有结果，也不会重新执行。"}</Status><a className="bp-button" href={path}>重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
