import Link from "next/link";
import { redirect } from "next/navigation";
import { blueprintApplication } from "@/lib/application";
import { resolveRequestActor } from "@/lib/supabase/request";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { BlueprintEditor } from "../../blueprint-editor";

export const metadata = { title: "编辑路径 · Blueprint" };

export default async function BlueprintEditPage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/blueprint/edit" />;
    redirect("/login?next=%2Fblueprint%2Fedit");
  }
  const { actor, client } = identity.value;
  const application = blueprintApplication(client);
  const [result, sessions] = await Promise.all([
    application.getMainBlueprint(actor).catch(() => ({ ok: false as const, code: "unavailable" as const })),
    application.listLearningSessions(actor).catch(() => ({ ok: false as const, code: "unavailable" as const })),
  ]);
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell">
    <nav className="actions" aria-label="路径编辑导航"><Link className="bp-button" href="/">← 返回蓝图</Link><Link className="bp-button" href="/paths">全部目标路径</Link></nav>
    <header><p className="brand">Blueprint / Path Studio</p><h1>编辑路径</h1>
      <p className="subtle">修改先成为草案。审阅并确认后，才会替换正式路径。</p>
      {result.ok && <p className="subtle">一份属于你的目标蓝图 · 版本 {result.value.version}</p>}
    </header>
    {result.ok ? <><BlueprintEditor initial={result.value} sessions={sessions.ok ? sessions.value : []} />
      {!sessions.ok && <p role="status">学习会话暂时无法读取，已有记录未被清空。</p>}</>
      : <section className="bp-panel editor-panel"><h2>蓝图暂时不可用</h2>
        <p className="subtle">没有清空已有路径或草案。</p><a className="bp-button" href="/blueprint/edit">重新读取</a></section>}
  </main></AccountThemeShell>;
}
