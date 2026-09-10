import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel } from "@blueprint/ui";
import { NotesWorkspace } from "@blueprint/ui/learning-notes";
import "@blueprint/ui/learning-notes.css";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readLearningNoteWorkspace } from "@/lib/learning-notes";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { recordLearningNoteAction, readLearningNoteWorkspaceAction } from "../../learning-note-actions";

export const metadata = { title: "视频笔记 · Blueprint" };

export default async function NotesPage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/progress/notes" />;
    redirect("/login?next=%2Fprogress%2Fnotes");
  }
  const { actor, client } = identity.value;
  const workspace = await readLearningNoteWorkspace(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell note-shell">
    <nav className="note-nav" aria-label="视频笔记导航"><Link className="bp-button" href="/">← 返回蓝图</Link>
      <Link className="bp-button" href="/paths">正式路径</Link><Link className="bp-button" href="/progress">成长档案</Link></nav>
    <header className="note-intro"><p className="brand">Blueprint / Field Notes</p><h1>视频笔记</h1>
      <p className="subtle">把一闪而过的理解、问题与灵感，留在它们发生的地方。原文仅自己可见。</p></header>
    {workspace.ok ? <NotesWorkspace accountId={actor.userId} initial={workspace.value}
      saveAction={recordLearningNoteAction.bind(null, actor.userId)} reloadAction={readLearningNoteWorkspaceAction.bind(null, actor.userId)} />
      : <Panel><h2>暂时无法读取笔记</h2><p>原记录与本机草稿没有被删除，请稍后重试。</p><a className="bp-button" href="/progress/notes">重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
