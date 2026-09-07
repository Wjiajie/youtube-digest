import { redirect } from "next/navigation";
import { Status } from "@blueprint/ui";

import { createServerSupabase } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/navigation";

import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const nextPath = safeInternalPath(next);
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(nextPath);
  return (
    <main className="login-shell">
      <section className="bp-panel login-card">
        <div className="brand">Blueprint Access</div>
        <h1>进入你的蓝图</h1>
        <p className="subtle">当前为受邀自测。输入受邀邮箱，我们会发送一次性登录链接。</p>
        {error === "invalid_link" ? <Status tone="danger">登录链接已失效或无法验证。请在发起请求的同一浏览器中打开最新邮件；仍无法登录时，再申请新链接。</Status> : null}
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
