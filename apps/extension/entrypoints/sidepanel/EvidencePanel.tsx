import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { ApplicationResult, EvidenceWorkspace, ProgressEvidence } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";
import { EvidenceJournal } from "@blueprint/ui/evidence-journal";
import "@blueprint/ui/evidence-journal.css";

// Remount only when the owning account changes. Theme, video navigation and
// collapsing the surface must not reset a private draft or an uncertain write.
export function EvidencePanel({ ownerId }: { ownerId: string }) {
  return <AccountEvidence key={ownerId} ownerId={ownerId} />;
}

function AccountEvidence({ ownerId }: { ownerId: string }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [initial, setInitial] = useState<EvidenceWorkspace | null>(null);
  const [failure, setFailure] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!started) return;
    let active = true;
    setLoading(true); setFailure(false);
    void browser.runtime.sendMessage({ type: "LOAD_EVIDENCE", ownerId }).then((result: ApplicationResult<EvidenceWorkspace>) => {
      if (!active) return;
      if (result.ok) setInitial(result.value);
      else setFailure(true);
    }).catch(() => { if (active) setFailure(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ownerId, started, attempt]);

  return <div className="extension-evidence">
    <Button className="web-link" aria-expanded={open} aria-controls="extension-evidence-content" onClick={() => { setOpen(!open); setStarted(true); }}>{open ? "收起成果记录" : "记录学习收获"}</Button>
    <section id="extension-evidence-content" aria-label="成果记录" hidden={!open}>
      <p className="muted">先核对关联节点再记录。切换视频不会自动移动草稿，也不要求先开始学习会话。</p>
      {loading ? <Status>正在读取私人路径与记录…</Status> : null}
      {failure ? <Panel><Status tone="warning">暂时无法读取成果。未删除本机草稿；请检查网络与账号连接后重试。</Status><Button disabled={loading} onClick={() => setAttempt((value) => value + 1)}>重新读取成果</Button></Panel> : null}
      {initial ? <EvidenceJournal accountId={ownerId} initial={initial}
        saveAction={(input) => browser.runtime.sendMessage({ type: "SAVE_EVIDENCE", ownerId, input }) as Promise<ApplicationResult<ProgressEvidence>>}
        reloadAction={() => browser.runtime.sendMessage({ type: "LOAD_EVIDENCE", ownerId }) as Promise<ApplicationResult<EvidenceWorkspace>>} /> : null}
    </section>
  </div>;
}
