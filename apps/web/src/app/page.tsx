import { redirect } from "next/navigation";
import Link from "next/link";

import { blueprintApplication } from "@/lib/application";
import { recordProductEvent } from "@/lib/product-events";
import { resolveRequestActor } from "@/lib/supabase/request";

import { logoutAction } from "./actions";
import { BlueprintEditor } from "./blueprint-editor";
import { AccountThemeShell } from "./account-theme-shell";
import { AuthUnavailable } from "./auth-unavailable";
import { LogoutForm } from "./logout-form";

export default async function HomePage() {
  const identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath="/" />;
    redirect("/login");
  }
  const context = identity.value;
  const application = blueprintApplication(context.client);
  const [result, sessions] = await Promise.all([
    application.getMainBlueprint(context.actor).catch(() => ({ ok: false as const, code: "unavailable" as const })),
    application.listLearningSessions(context.actor).catch(() => ({ ok: false as const, code: "unavailable" as const })),
  ]);
  if (!result.ok) {
    return (
      <main className="shell">
        <section className="bp-panel editor-panel">
          <h1>蓝图暂时不可用</h1>
          <p className="subtle">请确认数据库迁移已经完成，然后重新加载。</p>
        </section>
      </main>
    );
  }
  await recordProductEvent(context.client, context.actor, "blueprint_viewed", {
    entityType: "blueprint",
    entityId: result.value.id,
  });
  return (
    <AccountThemeShell accountId={context.actor.userId} client={context.client}><main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">Blueprint / M1 Cloud Slice</div>
          <p className="subtle">一份属于你的目标蓝图 · 版本 {result.value.version}</p>
        </div>
        <div className="actions"><Link className="bp-button" href="/settings/connections">扩展连接</Link><LogoutForm action={logoutAction} /></div>
      </header>
      <div className="hud">
        <aside className="bp-panel identity-panel" aria-label="身份状态面板">
          <div>
            <div className="brand">Identity Signal</div>
            <div className="avatar" aria-label="人物占位形象" />
          </div>
          <div>
            <strong>{result.value.goals.length} 个目标已接入</strong>
            <p className="subtle">3D 人物将在 M3 接替这个占位面板。现在先确保数据与路径真实属于你。</p>
          </div>
        </aside>
        <BlueprintEditor initial={result.value} sessions={sessions.ok ? sessions.value : []} />
      </div>
    </main></AccountThemeShell>
  );
}
