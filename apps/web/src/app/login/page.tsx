import { redirect } from "next/navigation";
import { Status } from "@blueprint/ui";

import { resolveRequestActor } from "@/lib/supabase/request";
import { safeInternalPath } from "@/lib/navigation";

import { LoginForm } from "./login-form";
import { AuthUnavailable } from "../auth-unavailable";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const nextPath = safeInternalPath(next);
  const identity = await resolveRequestActor();
  if (identity.ok) redirect(nextPath);
  if (identity.code === "unavailable") {
    const retryParams = new URLSearchParams({ next: nextPath });
    if (error === "invalid_link" || error === "exchange_unavailable") retryParams.set("error", error);
    return <AuthUnavailable retryPath={`/login?${retryParams}`} />;
  }
  return (
    <main className="login-shell">
      <section className="bp-panel login-card">
        <div className="brand">Blueprint Access</div>
        <h1>进入你的蓝图</h1>
        <p className="subtle">当前为受邀自测。输入受邀邮箱，我们会发送一次性登录链接。</p>
        {error === "invalid_link" ? <Status tone="danger">登录链接已失效或无法验证。请在发起请求的同一浏览器中打开最新邮件；仍无法登录时，再申请新链接。</Status> : null}
        {error === "exchange_unavailable" ? <Status tone="warning">暂时无法完成登录，无法确认这次链接交换的结果。不要反复点击旧链接；请稍后在此浏览器申请新链接，我们不会自动重发邮件。</Status> : null}
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
