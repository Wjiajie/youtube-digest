import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel } from "@blueprint/ui";
import { LearningPositionWorkspace } from "@blueprint/ui/learning-positions";
import "@blueprint/ui/learning-positions.css";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readLearningPositionWorkspace } from "@/lib/learning-positions";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { recordLearningPositionAction, readLearningPositionWorkspaceAction } from "../../learning-position-actions";

export const metadata = { title: "继续学习 · Blueprint" };
export default async function ResumePage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/progress/resume" />;
    redirect("/login?next=%2Fprogress%2Fresume");
  }
  const { actor, client } = identity.value;
  const workspace = await readLearningPositionWorkspace(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell position-shell">
    <nav className="position-nav" aria-label="继续学习导航"><Link className="bp-button" href="/">← 返回蓝图</Link>
      <Link className="bp-button" href="/paths">正式路径</Link><Link className="bp-button" href="/progress/notes">视频笔记</Link><Link className="bp-button" href="/progress">成长档案</Link></nav>
    <header className="position-intro"><p className="brand">Blueprint / Continue Learning</p><h1>继续学习</h1>
      <p>为下一次留一个清楚的起点。保存的位置随账号同步，输入草稿仅留在当前浏览器。</p></header>
    {workspace.ok ? <LearningPositionWorkspace accountId={actor.userId} initial={workspace.value}
      saveAction={recordLearningPositionAction.bind(null, actor.userId)} reloadAction={readLearningPositionWorkspaceAction.bind(null, actor.userId)} />
      : <Panel><h2>暂时无法读取学习位置</h2><p>不能据此判断历史为空；原记录与本机草稿没有被删除。</p><a className="bp-button" href="/progress/resume">重新读取</a></Panel>}
  </main></AccountThemeShell>;
}
