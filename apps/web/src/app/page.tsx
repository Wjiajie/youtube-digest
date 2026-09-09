import { redirect } from "next/navigation";
import Link from "next/link";

import { projectBlueprintProgress } from "@blueprint/domain";
import { readNodeStatusWorkspace } from "@/lib/node-status";
import { recordProductEvent } from "@/lib/product-events";
import { resolveRequestActor } from "@/lib/supabase/request";

import { logoutAction } from "./actions";
import { HomeDashboard } from "./home-dashboard";
import { AccountThemeShell } from "./account-theme-shell";
import { AuthUnavailable } from "./auth-unavailable";
import { LogoutForm } from "./logout-form";

export default async function HomePage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/" />;
    redirect("/login");
  }
  const { actor, client } = identity.value;
  const result = await readNodeStatusWorkspace(client, actor).catch(() => ({ ok: false as const, code: "unavailable" as const }));
  if (result.ok) await recordProductEvent(client, actor, "blueprint_viewed", {
    entityType: "blueprint",
    entityId: result.value.blueprint.id,
  });
  return (
    <AccountThemeShell accountId={actor.userId} client={client}><main className="shell">
      <header className="topbar home-topbar">
        <div>
          <div className="brand">Blueprint / Your Becoming</div>
          <h1>我的蓝图</h1>
        </div>
        <nav className="actions" aria-label="蓝图导航"><Link className="bp-button" href="/paths">全部目标</Link><Link className="bp-button" href="/progress">成长档案</Link><Link className="bp-button" href="/settings/connections">扩展连接</Link><LogoutForm action={logoutAction} /></nav>
      </header>
      {result.ok ? <HomeDashboard key={actor.userId} goals={projectBlueprintProgress(result.value.blueprint, result.value.current)} evidence={result.value.evidence} />
        : <section className="bp-panel editor-panel"><h2>蓝图暂时不可用</h2><p className="subtle">没有清空已有路径或状态。请稍后重新读取。</p>
          <a className="bp-button" href="/">重新读取</a></section>}
    </main></AccountThemeShell>
  );
}
