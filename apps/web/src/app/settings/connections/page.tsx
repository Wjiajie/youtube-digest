import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";

import { Connections } from "./connections";
import { AccountThemeShell } from "@/app/account-theme-shell";

export default async function ConnectionsPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return (
    <AccountThemeShell accountId={data.user.id} client={supabase}><main className="shell">
      <header className="topbar"><div><div className="brand">Blueprint Settings</div><h1>扩展连接</h1></div><Link className="bp-button" href="/">返回蓝图</Link></header>
      <section className="bp-panel editor-panel">
        <p className="subtle">你可以查看并撤销已授权的 Blueprint 扩展。撤销会立即删除该客户端的刷新令牌。</p>
        <Connections />
      </section>
    </main></AccountThemeShell>
  );
}
