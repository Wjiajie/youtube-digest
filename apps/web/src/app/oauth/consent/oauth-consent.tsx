"use client";

import { useEffect, useState } from "react";

import { Button, Status } from "@blueprint/ui";

import { createBrowserSupabase } from "@/lib/supabase/browser";

export function OAuthConsent({ authorizationId }: { authorizationId: string }) {
  const [clientName, setClientName] = useState("Blueprint YouTube Companion");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authorizationId) {
      setError("授权请求无效，请返回扩展重新连接。");
      setBusy(false);
      return;
    }
    const supabase = createBrowserSupabase();
    void (async () => {
      const result: any = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (result.error) setError("授权请求已失效，请返回扩展重试。");
      else if (result.data && "redirect_url" in result.data) window.location.assign(result.data.redirect_url);
      else if (result.data && "client" in result.data) setClientName(result.data.client.name ?? "Blueprint YouTube Companion");
      setBusy(false);
    })();
  }, [authorizationId]);

  async function decide(approved: boolean) {
    setBusy(true);
    setError("");
    const supabase = createBrowserSupabase();
    const result = approved
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
      setError("无法完成授权，请返回扩展重试。");
      setBusy(false);
      return;
    }
    await fetch("/api/v1/events/extension-authorization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: approved ? "approved" : "denied" }),
    });
    window.location.assign(result.data.redirect_url);
  }

  return (
    <div>
      <p><strong>{clientName}</strong> 希望：</p>
      <ul>
        <li>读取你的目标、阶段、路径节点和 YouTube 绑定</li>
        <li>在你明确点击后创建学习会话</li>
      </ul>
      <p className="subtle">扩展不能修改正式蓝图，也不会获得 Agent 或服务端密钥。</p>
      {error ? <Status tone="danger">{error}</Status> : null}
      <div className="actions">
        <Button disabled={busy} onClick={() => void decide(false)}>拒绝</Button>
        <Button className="primary" disabled={busy || Boolean(error)} onClick={() => void decide(true)}>{busy ? "正在检查…" : "允许连接"}</Button>
      </div>
    </div>
  );
}
