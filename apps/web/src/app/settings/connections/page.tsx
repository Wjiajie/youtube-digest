import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveRequestActor } from "@/lib/supabase/request";

import { Connections } from "./connections";
import { AccountThemeShell } from "@/app/account-theme-shell";
import { AuthUnavailable } from "@/app/auth-unavailable";

export default async function ConnectionsPage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/settings/connections" />;
    redirect("/login");
  }
  const { actor, client } = identity.value;
  return (
    <AccountThemeShell accountId={actor.userId} client={client}><main className="shell">
      <header className="topbar"><div><div className="brand">Blueprint Settings</div><h1>扩展连接</h1></div><Link className="bp-button" href="/">返回蓝图</Link></header>
      <section className="bp-panel editor-panel">
        <p className="subtle">你可以查看并撤销已授权的 Blueprint 扩展。撤销会立即删除该客户端的刷新令牌。</p>
        <Connections />
      </section>
    </main></AccountThemeShell>
  );
}
