"use client";

import { useEffect, useState } from "react";

import { Button, Status } from "@blueprint/ui";

import { createBrowserSupabase } from "@/lib/supabase/browser";

type Grant = { client: { id: string; name?: string }; scopes: string[]; granted_at: string };

export function Connections() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    const result = await createBrowserSupabase().auth.oauth.listGrants();
    if (result.error) setError("暂时无法读取授权列表。");
    else setGrants((result.data ?? []) as Grant[]);
    setBusy(false);
  }

  useEffect(() => { void load(); }, []);

  async function revoke(clientId: string) {
    setBusy(true);
    setError("");
    const result = await createBrowserSupabase().auth.oauth.revokeGrant({ clientId });
    if (result.error) {
      setError("撤销失败，请稍后重试。");
      setBusy(false);
      return;
    }
    await fetch("/api/v1/events/extension-revoked", { method: "POST" });
    setMessage("授权已撤销，扩展需要重新连接才能访问蓝图。");
    await load();
  }

  if (busy && grants.length === 0) return <Status>正在读取授权…</Status>;
  return (
    <div>
      {message ? <Status tone="success">{message}</Status> : null}
      {error ? <Status tone="danger">{error}</Status> : null}
      {grants.length === 0 ? <p className="empty">当前没有已授权的扩展。</p> : grants.map((grant) => (
        <div className="goal-card row" key={grant.client.id}>
          <div><strong>{grant.client.name ?? "Blueprint Extension"}</strong><p className="subtle">授权于 {new Date(grant.granted_at).toLocaleString("zh-CN")}</p></div>
          <Button className="danger" disabled={busy} onClick={() => void revoke(grant.client.id)}>撤销授权</Button>
        </div>
      ))}
    </div>
  );
}
