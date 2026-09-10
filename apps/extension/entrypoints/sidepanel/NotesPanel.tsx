import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { ApplicationResult, LearningNote, LearningNoteWorkspace } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";
import { NotesWorkspace } from "@blueprint/ui/learning-notes";
import "@blueprint/ui/learning-notes.css";

export function NotesPanel({ ownerId }: { ownerId: string }) {
  return <AccountNotes key={ownerId} ownerId={ownerId} />;
}

function AccountNotes({ ownerId }: { ownerId: string }) {
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false), [attempt, setAttempt] = useState(0);
  const [initial, setInitial] = useState<LearningNoteWorkspace | null>(null);
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [identityLost, setIdentityLost] = useState(false);
  useEffect(() => {
    if (!started) return;
    let active = true; setLoading(true); setFailed(false);
    void browser.runtime.sendMessage({ type: "LOAD_LEARNING_NOTES", ownerId }).then((result: ApplicationResult<LearningNoteWorkspace>) => {
      if (!active) return;
      if (result.ok) setInitial(result.value);
      else if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
      else setFailed(true);
    }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, started, attempt]);

  async function request<T>(type: string, input?: unknown): Promise<ApplicationResult<T>> {
    if (identityLost) return { ok: false, code: "forbidden" };
    try {
      const result = await browser.runtime.sendMessage({ type, ownerId, ...(input === undefined ? {} : { input }) }) as ApplicationResult<T>;
      if (!result.ok && (result.code === "forbidden" || result.code === "unauthenticated")) setIdentityLost(true);
      return result;
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return <div className="extension-notes">
    <Button className="web-link" aria-expanded={open} aria-controls="extension-notes-content" onClick={() => { setOpen(!open); setStarted(true); }}>{open ? "收起视频笔记" : "记录视频笔记"}</Button>
    <section id="extension-notes-content" aria-label="视频笔记" hidden={!open}>
      <p className="muted">手动选择笔记关联的视频。可填写位置，或明确读取当前视频的位置；切换视频不会移动草稿，也不会自动记录观看或掌握。</p>
      {identityLost ? <Status tone="warning">账号连接已变化，私人笔记已隐藏。请重新连接账号。</Status> : <>
        {loading ? <Status>正在读取私人笔记…</Status> : null}
        {failed ? <Panel><Status tone="warning">暂时无法读取视频笔记，不能据此判断历史为空。</Status>
          <Button disabled={loading} onClick={() => setAttempt(value => value + 1)}>重新读取视频笔记</Button></Panel> : null}
        {initial ? <NotesWorkspace accountId={ownerId} initial={initial}
          saveAction={input => request<LearningNote>("SAVE_LEARNING_NOTE", input)}
          capturePosition={videoId => request<{ videoId: string; positionSeconds: number }>("READ_NOTE_POSITION", { videoId })}
          reloadAction={() => request<LearningNoteWorkspace>("LOAD_LEARNING_NOTES")} /> : null}
      </>}
    </section>
  </div>;
}
