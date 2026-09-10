import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Panel, Status } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createResourceWorkspace } from "@/lib/agent/resource-workspace";
import { resourceConfiguration } from "@/lib/agent/resource-runtime";
import { AccountThemeShell } from "../../../account-theme-shell";
import { AuthUnavailable } from "../../../auth-unavailable";
import { ResourceNodeWorkbench } from "../../resource-workbench";
import "../../resource-workbench.css";

export const metadata = { title: "节点资源 · Blueprint" };
export default async function ResourceNodePage({ params, searchParams }: { params: Promise<{ nodeId: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ nodeId }, query] = await Promise.all([params, searchParams]);
  const page = Number(query.page ?? "1");
  if (!z.uuid().safeParse(nodeId).success || !Number.isSafeInteger(page) || page < 1 || page > 50_001) notFound();
  const path = `/resources/nodes/${nodeId}?page=${page}`, identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value;
  const result = await createResourceWorkspace(client, actor).node(nodeId, (page - 1) * 20);
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell resource-shell">
    <nav aria-label="资源导航"><Link className="bp-button" prefetch={false} href="/paths">← 全部路径</Link></nav>
    {result.ok ? <ResourceNodeWorkbench key={`${actor.userId}:${nodeId}`} accountId={actor.userId} initial={result.value} enabled={resourceConfiguration() !== null} />
      : <Panel><h1>暂时无法打开节点资源</h1><Status tone="warning">{result.code === "not_found" || result.code === "forbidden"
        ? "没有找到可访问的学习节点，可能已调整或移除。已保存运行仍可通过原记录链接查看。" : "读取服务暂时不可用，没有清空已有资源或记录。"}</Status><a className="bp-button" href={path}>重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
