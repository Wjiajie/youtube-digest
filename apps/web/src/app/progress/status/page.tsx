import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel } from "@blueprint/ui";
import { NodeStatusWorkspacePanel } from "@blueprint/ui/node-status-workspace";
import "@blueprint/ui/node-status-workspace.css";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readNodeStatusWorkspace } from "@/lib/node-status";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { confirmNodeStatusAction, readNodeStatusWorkspaceAction } from "../../node-status-actions";

export const metadata = { title: "节点状态 · Blueprint" };

export default async function NodeStatusPage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/progress/status" />;
    redirect("/login?next=%2Fprogress%2Fstatus");
  }
  const { actor, client } = identity.value;
  const result = await readNodeStatusWorkspace(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell node-status-shell">
    <nav className="node-status-nav" aria-label="节点状态导航">
      <Link href="/" className="bp-button">← 返回蓝图</Link><Link href="/progress" className="bp-button">成长档案</Link>
    </nav>
    <header className="node-status-intro"><p className="brand">Blueprint / Your Assessment</p><h1>节点状态</h1>
      <p className="subtle">对照完成依据，记录你对这一步的判断。进展由你确认，不由观看次数决定。</p></header>
    {result.ok ? <NodeStatusWorkspacePanel accountId={actor.userId} initial={result.value}
      saveAction={confirmNodeStatusAction.bind(null, actor.userId)}
      reloadAction={readNodeStatusWorkspaceAction.bind(null, actor.userId)} />
      : <Panel><h2>暂时无法读取节点状态</h2><p className="subtle">没有清空已有确认或本机请求。请稍后重新读取。</p>
        <a className="bp-button" href="/progress/status">重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
