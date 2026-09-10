"use client";
import { useEffect, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";

/** No body rendered in SSR/first hydration; recheck sleeping tabs without fetching or renewing evidence. */
export function useEvidenceDeadline(deadline: string | null) {
  const [clock, setClock] = useState<{ deadline: string | null; expired: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function check() {
      clearTimeout(timer);
      const remaining = deadline === null ? NaN : Date.parse(deadline) - Date.now();
      const expired = !Number.isFinite(remaining) || remaining <= 0;
      setClock(previous => ({ deadline, expired: expired || (previous?.deadline === deadline && previous.expired) }));
      if (!expired) timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    }
    check();
    window.addEventListener("pageshow", check); window.addEventListener("focus", check); document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); window.removeEventListener("pageshow", check); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [deadline]);
  return clock?.deadline !== deadline ? "checking" : clock.expired ? "expired" : "available";
}

export function EvidenceDeadlineNotice({ state, busy, message, onRead }: {
  state: "checking" | "expired"; busy: boolean; message: string; onRead: () => void;
}) {
  return <div className="resource-workbench resource-evidence-notice"><Panel className="resource-card">
    <p className="resource-eyebrow">EVIDENCE / LIFETIME</p><h1>{state === "checking" ? "正在核对证据期限" : "证据使用期限已到"}</h1>
    <Status tone={state === "checking" || busy ? "progress" : "warning"}>{state === "checking" ? "核对期间不展示旧材料。" : "旧材料已隐藏，不能继续匹配或确认采用；不会自动重新检索、核验或扣次。"}</Status>
    <p>正式路径、资源绑定与学习记录仍保留。读取云端记录可确认清除回执；此页面隐藏不等于备份或提供方副本已删除。</p>
    <div className="resource-actions"><Button disabled={busy || state === "checking"} onClick={onRead}>读取清除状态</Button><a className="bp-button" href="/paths">返回路径</a></div>
    {message && <Status tone="neutral">{message}</Status>}
  </Panel></div>;
}
