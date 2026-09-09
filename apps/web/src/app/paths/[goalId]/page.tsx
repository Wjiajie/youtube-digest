import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { projectBlueprintProgress } from "@blueprint/domain";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readNodeStatusWorkspace } from "@/lib/node-status";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { GoalPathView } from "../path-views";

export const metadata = { title: "目标路径 · Blueprint" };
export default async function GoalPathPage({ params, searchParams }: {
  params: Promise<{ goalId: string }>; searchParams: Promise<{ node?: string | string[] }>;
}) {
  const [{ goalId }, query] = await Promise.all([params, searchParams]);
  const node = typeof query.node === "string" ? query.node : undefined;
  const path = `/paths/${encodeURIComponent(goalId)}${node ? `?node=${encodeURIComponent(node)}` : ""}`;
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value;
  const result = await readNodeStatusWorkspace(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  const goal = result.ok ? projectBlueprintProgress(result.value.blueprint, result.value.current).find(item => item.goal.id === goalId) : undefined;
  if (result.ok && !goal) notFound();
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell">
    <nav className="actions" aria-label="蓝图导航"><Link className="bp-button" href="/">← 返回蓝图</Link></nav>
    {goal ? <GoalPathView goal={goal} selectedNodeId={node} />
      : <section className="bp-panel editor-panel"><h1>暂时无法读取路径</h1><p>没有清空已有路径。</p><a href={path}>重新读取</a></section>}
  </main></AccountThemeShell>;
}
