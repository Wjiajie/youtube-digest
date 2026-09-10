import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel } from "@blueprint/ui";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readEvidenceWorkspace } from "@/lib/progress-evidence";
import { AccountThemeShell } from "../account-theme-shell";
import { AuthUnavailable } from "../auth-unavailable";
import { readEvidenceWorkspaceAction, recordProgressEvidenceAction } from "../progress-evidence-actions";
import { EvidenceJournal } from "@blueprint/ui/evidence-journal";
import "@blueprint/ui/evidence-journal.css";

export const metadata = { title: "成长档案 · Blueprint" };

export default async function ProgressPage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/progress" />;
    redirect("/login?next=%2Fprogress");
  }
  const { actor, client } = identity.value;
  const workspace = await readEvidenceWorkspace(client, actor);
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell evidence-shell">
    <nav className="evidence-nav" aria-label="成长档案导航"><Link href="/" className="bp-button">← 返回蓝图</Link><Link href="/progress/status" className="bp-button">确认节点状态</Link><Link href="/progress/notes" className="bp-button">视频笔记</Link><Link href="/progress/resume" className="bp-button">继续学习</Link><span className="brand">Blueprint / Journal</span></nav>
    <header className="evidence-intro">
      <div><p className="brand">每一步，都有回声</p><h1>成长档案</h1><p className="subtle">把做过的尝试、发现的变化，留给未来的自己。</p></div>
      <div className="evidence-seal" aria-hidden="true">记<span>YOUR JOURNEY</span></div>
    </header>
    {workspace.ok ? <EvidenceJournal accountId={actor.userId} initial={workspace.value}
      saveAction={recordProgressEvidenceAction.bind(null, actor.userId)}
      reloadAction={readEvidenceWorkspaceAction.bind(null, actor.userId)} />
      : <Panel className="evidence-compose"><h2>暂时无法读取成长路径</h2><p className="subtle">没有删除已有记录或本机草稿。请稍后重试。</p><a href="/progress" className="bp-button">重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
