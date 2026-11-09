"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { CompanionPreferences } from "@/lib/companion/contracts";
import type { AvatarCapabilitiesSnapshot } from "@/lib/companion/avatar-capabilities";
import {
  createAvatarController,
  type AvatarCapabilities,
  type AvatarController,
} from "./avatar-controller";
export const AvatarStage = forwardRef<
  AvatarController | undefined,
  {
    value: CompanionPreferences;
    compact?: boolean;
    onCapabilities?: (caps: AvatarCapabilities) => void;
    onAgentCapabilities?: (caps: AvatarCapabilitiesSnapshot | null) => void;
  }
>(function AvatarStage({ value, compact, onCapabilities, onAgentCapabilities }, ref) {
  const host = useRef<HTMLDivElement>(null),
    controller = useRef<AvatarController | undefined>(undefined),
    latest = useRef(value),
    applied = useRef(value);
  const agentCallback = useRef(onAgentCapabilities);
  agentCallback.current = onAgentCapabilities;
  const [status, setStatus] = useState("正在迎接 Shayna…"),
    [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false);
  latest.current = value;
  useImperativeHandle(ref, () => controller.current, [ready]);
  useEffect(() => {
    let active = true;
    try {
      controller.current = createAvatarController(
        host.current!,
        (s, caps) => {
          if (!active) return;
          setStatus(s);
          agentCallback.current?.(controller.current?.getAgentCapabilities?.() ?? null);
          if (caps) {
            setReady(true);
            onCapabilities?.(caps);
          }
        },
        compact ? 20 : 160,
      );
      applied.current = latest.current;
      void controller.current.setAppearance(latest.current).catch(() => {
        if (active) {
          agentCallback.current?.(null);
          setStatus("形象暂时无法加载，对话仍可使用。请检查本地资源或重试。");
        }
      });
    } catch {
      agentCallback.current?.(null);
      setStatus("此设备暂不支持 3D 展示，对话仍可使用。");
    }
    return () => {
      active = false;
      controller.current?.dispose();
      agentCallback.current?.(null);
      controller.current = undefined;
    };
    // The controller owns mutable scene state; preference changes do not recreate WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry, compact]);
  useEffect(() => {
    if (applied.current === value) return;
    applied.current = value;
    void controller.current
      ?.setAppearance(value)
      .catch(() => { agentCallback.current?.(null); setStatus("切换未完成，已保留当前形象。"); });
  }, [value]);
  return (
    <div className="companion-stage" aria-label="全屏 3D 展示区">
      <div ref={host} className="companion-canvas" />
      {status && (
        <div className="companion-stage-status" role="status">
          <span>{status}</span>
          <button onClick={() => setRetry((n) => n + 1)}>重新加载</button>
        </div>
      )}
    </div>
  );
});
