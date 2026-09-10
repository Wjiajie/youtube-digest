import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { ApplicationResult, LearningPosition, LearningPositionWorkspace as PositionWorkspace } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";
import { LearningPositionWorkspace } from "@blueprint/ui/learning-positions";
import "@blueprint/ui/learning-positions.css";

export function PositionsPanel({ ownerId }: { ownerId: string }) {
  return <AccountPositions key={ownerId} ownerId={ownerId} />;
}

function AccountPositions({ ownerId }: { ownerId: string }) {
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false), [attempt, setAttempt] = useState(0);
  const [initial, setInitial] = useState<PositionWorkspace | null>(null);
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [identityLost, setIdentityLost] = useState(false);
  useEffect(() => {
    if (!started) return;
    let active = true; setLoading(true); setFailed(false);
    void browser.runtime.sendMessage({ type: "LOAD_LEARNING_POSITIONS", ownerId }).then((result: ApplicationResult<PositionWorkspace>) => {
      if (!active) return;
      if (result.ok) setInitial(result.value);
      else if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
      else setFailed(true);
    }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, started, attempt]);

  async function request<T>(type: string, fields: object = {}): Promise<ApplicationResult<T>> {
    if (identityLost) return { ok: false, code: "forbidden" };
    try {
      const result = await browser.runtime.sendMessage({ type, ownerId, ...fields }) as ApplicationResult<T>;
      if (!result.ok && (result.code === "forbidden" || result.code === "unauthenticated")) setIdentityLost(true);
      return result;
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return <div className="extension-positions">
    <Button className="web-link" aria-expanded={open} aria-controls="extension-positions-content" onClick={() => { setOpen(!open); setStarted(true); }}>{open ? "收起继续学习" : "继续学习"}</Button>
    <section id="extension-positions-content" aria-label="继续学习位置" hidden={!open}>
      <p className="muted">明确保存下次继续的位置。切换视频不会移动输入，也不会自动记录观看、完成或掌握。</p>
      {identityLost ? <Status tone="warning">账号连接已变化，私人学习位置已隐藏。请重新连接账号。</Status> : <>
        {loading ? <Status>正在读取私人学习位置…</Status> : null}
        {failed ? <Panel><Status tone="warning">暂时无法读取学习位置，不能据此判断历史为空。</Status>
          <Button disabled={loading} onClick={() => setAttempt(value => value + 1)}>重新读取学习位置</Button></Panel> : null}
        {initial ? <LearningPositionWorkspace accountId={ownerId} initial={initial}
          saveAction={input => request<LearningPosition>("SAVE_LEARNING_POSITION", { input })}
          capturePosition={videoId => request<{ videoId: string; positionSeconds: number }>("READ_LEARNING_POSITION", { input: { videoId } })}
          reloadAction={resourceBindingId => request<PositionWorkspace>("LOAD_LEARNING_POSITIONS", resourceBindingId === undefined ? {} : { resourceBindingId })} /> : null}
      </>}
    </section>
  </div>;
}
