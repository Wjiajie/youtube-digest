"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { Status } from "@blueprint/ui";

export function LogoutForm({ action, label = "退出所有设备" }: { action: () => Promise<void>; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  return (
    <form action={action} onSubmit={(event) => {
      event.preventDefault();
      if (inFlight.current) return;
      inFlight.current = true;
      setFailed(false);
      startTransition(async () => {
        try {
          await action();
        } catch (error) {
          // Let Next handle navigation signals; only transport failures belong
          // to this form. A lost response does not prove sign-out succeeded.
          unstable_rethrow(error);
          setFailed(true);
        } finally {
          inFlight.current = false;
        }
      });
    }}>
      <button className="bp-button" disabled={pending}>{pending ? "正在退出…" : label}</button>
      {failed ? <Status tone="warning">无法确认退出结果。请检查网络后重试，不要将本次操作视为已退出。</Status> : null}
    </form>
  );
}
