export function AuthUnavailable({ retryPath }: { retryPath: string }) {
  return (
    <main className="login-shell">
      <section className="bp-panel login-card" aria-labelledby="auth-recovery-title">
        <div className="brand">Blueprint Access</div>
        <h1 id="auth-recovery-title">暂时无法验证登录状态</h1>
        <p className="subtle" role="status">账号服务暂时不可用。请稍后重试，无需重新申请登录邮件。</p>
        <div className="actions auth-recovery-actions"><a className="bp-button" href={retryPath}>重新加载</a></div>
      </section>
    </main>
  );
}
