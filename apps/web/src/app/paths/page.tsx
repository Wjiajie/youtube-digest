import Link from "next/link";
import { redirect } from "next/navigation";
import { projectBlueprintProgress } from "@blueprint/domain";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readNodeStatusWorkspace } from "@/lib/node-status";
import { AccountThemeShell } from "../account-theme-shell";
import { AuthUnavailable } from "../auth-unavailable";
import { PathsOverview } from "./path-views";

export const metadata = { title: "全部目标路径 · Blueprint" };
export default async function PathsPage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/paths" />;
    redirect("/login?next=%2Fpaths");
  }
  const { actor, client } = identity.value;
  const result = await readNodeStatusWorkspace(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell">
    <nav className="actions" aria-label="目标路径导航"><Link className="bp-button" href="/">← 返回蓝图</Link>
      <Link className="bp-button" href="/goals">目标定义</Link><Link className="bp-button" href="/blueprint/edit">编辑路径</Link></nav>
    {result.ok ? <PathsOverview goals={projectBlueprintProgress(result.value.blueprint, result.value.current)} />
      : <section className="bp-panel editor-panel"><h1>暂时无法读取路径</h1><p>没有清空已有路径。</p><a href="/paths">重新读取</a></section>}
  </main></AccountThemeShell>;
}
