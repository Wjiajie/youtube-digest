import { redirect } from "next/navigation";

import { resolveRequestActor } from "@/lib/supabase/request";

import { OAuthConsent } from "./oauth-consent";
import { AccountThemeShell } from "@/app/account-theme-shell";
import { AuthUnavailable } from "@/app/auth-unavailable";

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams;
  const identity = await resolveRequestActor();
  const continuation = authorizationId
    ? `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
    : "/oauth/consent";
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={continuation} />;
    if (authorizationId) redirect(`/login?next=${encodeURIComponent(continuation)}`);
  }
  const content = (
    <main className="login-shell">
      <section className="bp-panel login-card">
        <div className="brand">Extension Access</div>
        <h1>连接 Blueprint 扩展</h1>
        <OAuthConsent authorizationId={authorizationId ?? ""} />
      </section>
    </main>
  );
  return identity.ok ? <AccountThemeShell accountId={identity.value.actor.userId} client={identity.value.client}>{content}</AccountThemeShell> : content;
}
