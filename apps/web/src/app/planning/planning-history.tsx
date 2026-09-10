"use client";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Panel, Status } from "@blueprint/ui";
import { PlanningStart } from "./planning-start";

type Props = { start: Omit<ComponentProps<typeof PlanningStart>, "onIdentityLost">; heading: ReactNode; children: ReactNode };
export function PlanningHistory(props: Props) {
  return <HistorySession key={`${props.start.accountId}:${props.start.briefId}`} {...props} />;
}
function HistorySession({ start, heading, children }: Props) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return <Panel className="brief-card"><Status tone="warning">当前身份无法访问，目标与规划记录已隐藏。</Status><a className="bp-button" href="/login?next=%2Fgoals">重新登录</a></Panel>;
  return <>{heading}<PlanningStart {...start} onIdentityLost={() => setHidden(true)} />{children}</>;
}
