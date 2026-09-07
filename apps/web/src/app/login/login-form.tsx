"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Status } from "@blueprint/ui";

export function LoginForm({ nextPath = "/" }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setCooldown(remaining);
      if (!remaining) setRetryAt(0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function requestCode() {
    if (inFlight.current || sent || Date.now() < retryAt) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, next: nextPath }),
      });
      if (response.status === 429) {
        setRetryAt(Date.now() + 60_000);
        setCooldown(60);
        throw new Error("邮件服务暂时限流。请勿连续发送；页面将在 60 秒后允许手动重试，但服务额度可能需要更久才能恢复。");
      }
      if (!response.ok) throw new Error("登录邮件服务暂不可用。邮箱已保留，请稍后手动重试。");
      setSent(true);
      setMessage("请求已提交。如果该邮箱已受邀，请检查收件箱和垃圾邮件，并在同一浏览器中打开最新登录链接。请求受理不代表邮件已送达。");
    } catch (caught) {
      setError(caught instanceof TypeError ? "网络连接中断。无法确认请求是否送达，请先检查邮箱，不要连续重试。" : caught instanceof Error ? caught.message : "暂时无法发送登录邮件。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void requestCode();
      }}
    >
      <label className="field">
        <span>邮箱</span>
        <input type="email" required autoComplete="email" value={email} disabled={sent || busy} onChange={(event) => setEmail(event.target.value)} />
      </label>
      {message ? <Status tone="success">{message}</Status> : null}
      {error ? <Status tone="danger">{error}</Status> : null}
      <div className="actions">
        {sent ? <Button type="button" disabled={busy} onClick={() => { setSent(false); setMessage(""); setError(""); }}>更换邮箱</Button> : <span />}
        <Button className="primary" disabled={busy || sent || cooldown > 0}>{busy ? "请稍候…" : sent ? "请求已提交" : cooldown > 0 ? `${cooldown} 秒后可手动重试` : "发送登录链接"}</Button>
      </div>
    </form>
  );
}
