import { Status } from "@blueprint/ui";

import { resolveRequestActor } from "@/lib/supabase/request";
import { logoutAction } from "../../actions";
import { LogoutForm } from "../../logout-form";
import { LoginForm } from "../../login/login-form";

export default async function LogoutRecoveryPage() {
  const identity = await resolveRequestActor().catch(() => ({ ok: false as const, code: "unavailable" as const }));
  return (
    <main className="login-shell">
      <section className="bp-panel login-card" aria-labelledby="logout-recovery-title">
        <div className="brand">Blueprint Access</div>
        <h1 id="logout-recovery-title">无法确认完整退出</h1>
        <Status tone="warning">未能确认云端会话撤销，其他设备可能仍保持登录。</Status>
        {identity.ok ? <>
          <p className="subtle">当前浏览器仍有有效登录。确认后可重试退出所有设备；此操作不等于撤销扩展的长期授权。</p>
          <LogoutForm action={logoutAction} label="重试退出所有设备" />
        </> : identity.code === "unavailable" ? <>
          <p className="subtle">暂时无法验证当前登录状态，请稍后重新检查。不要将本次操作视为已退出，也无需反复申请登录邮件。</p>
          <div className="actions auth-recovery-actions"><a className="bp-button" href="/auth/logout-recovery">重新检查登录状态</a></div>
        </> : <>
          <p className="subtle">当前浏览器没有有效登录。请稍后重新登录，再重试退出所有设备；我们不会自动发送邮件或执行退出。</p>
          <LoginForm nextPath="/auth/logout-recovery" />
        </>}
      </section>
    </main>
  );
}
