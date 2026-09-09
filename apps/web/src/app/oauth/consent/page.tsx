import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";

import { OAuthConsent } from "./oauth-consent";
import { AccountThemeShell } from "@/app/account-theme-shell";

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams;
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (authorizationId) {
    if (!data.user) {
      const continuation = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
      redirect(`/login?next=${encodeURIComponent(continuation)}`);
    }
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
  return data.user ? <AccountThemeShell accountId={data.user.id} client={supabase}>{content}</AccountThemeShell> : content;
}
