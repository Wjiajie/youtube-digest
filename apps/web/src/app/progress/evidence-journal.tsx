"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { recordProgressEvidenceSchema, type ApplicationResult, type ProgressEvidence } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";
import type { EvidenceWorkspace } from "@/lib/progress-evidence";

type Props = {
  accountId: string;
  initial: EvidenceWorkspace;
  saveAction: (input: unknown) => Promise<ApplicationResult<ProgressEvidence>>;
  reloadAction: () => Promise<ApplicationResult<EvidenceWorkspace>>;
};
const draftSchema = z.object({
  schemaVersion: z.literal(1), baseVersion: z.int().nonnegative(),
  nodeId: z.string(), nodeTitle: z.string(), text: z.string(), artifactUrl: z.string(),
  attempt: recordProgressEvidenceSchema.optional(),
});
type Draft = z.infer<typeof draftSchema>;
const blankDraft = (version: number): Draft => ({ schemaVersion: 1, baseVersion: version, nodeId: "", nodeTitle: "", text: "", artifactUrl: "" });

// Account/Blueprint changes remount the private state; a theme change never does.
export function EvidenceJournal(props: Props) {
  return <Journal key={`${props.accountId}:${props.initial.blueprint.id}`} {...props} />;
}

function Journal({ accountId, initial, saveAction, reloadAction }: Props) {
  const [blueprint, setBlueprint] = useState(initial.blueprint);
  const [historyUnavailable, setHistoryUnavailable] = useState(!initial.records.ok);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [storageWarning, setStorageWarning] = useState("");
  const [unreadableDraft, setUnreadableDraft] = useState<string | null>(null);
  const [lockState, setLockState] = useState<"pending" | "owned" | "elsewhere" | "unsupported">("pending");
  const [lockAttempt, setLockAttempt] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [identityLost, setIdentityLost] = useState(false);
  const [records, setRecords] = useState(initial.records.ok ? initial.records.value : []);
  const inFlight = useRef(false);
  const active = useRef(false);
  const storageKey = `blueprint-evidence-draft:${accountId}:${initial.blueprint.id}`;
  const nodes = blueprint.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes.map((node) => ({
    ...node, label: `${goal.title} / ${stage.title} / ${node.title}`,
  }))));
  const selectedExists = nodes.some((node) => node.id === draft?.nodeId);
  const versionChanged = Boolean(draft && draft.baseVersion !== blueprint.version);
  const editable = lockState === "owned";

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    let release: (() => void) | undefined;
    const restore = () => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === null) setDraft(blankDraft(initial.blueprint.version));
        else {
          try { setDraft(draftSchema.parse(JSON.parse(saved))); setUnreadableDraft(null); }
          catch { setUnreadableDraft(saved); }
        }
      } catch {
        setStorageWarning("无法读取本机恢复草稿。原数据不会自动删除，请先保留已有内容。");
        setDraft(blankDraft(initial.blueprint.version));
      }
    };
    setLockState("pending");
    if (!navigator.locks) { restore(); setLockState("unsupported"); }
    else {
      // Cancel abandoned Strict Mode effect setups before they request a lock.
      void Promise.resolve().then(() => {
        if (cancelled) return;
        return navigator.locks.request(storageKey, { ifAvailable: true }, async (lock) => {
          if (cancelled) return;
          restore();
          if (!lock) { setLockState("elsewhere"); return; }
          setLockState("owned");
          await new Promise<void>((resolve) => { release = resolve; });
        });
      }).catch(() => {
        if (!cancelled) { restore(); setLockState("unsupported"); }
      });
    }
    return () => { cancelled = true; active.current = false; release?.(); };
  }, [storageKey, lockAttempt]);

  function update(next: Draft) {
    if (!editable) return;
    setDraft(next);
    setMessage("");
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageWarning(""); }
    catch { setStorageWarning("浏览器无法保存恢复草稿。请勿关闭本页，并先复制文字留存。"); }
  }

  async function save() {
    if (inFlight.current || !draft || identityLost || !editable) return;
    if (!draft.attempt && (versionChanged || !selectedExists)) {
      setMessage("请先选择当前有效的节点，并确认路径版本。草稿不会自动移动到其他节点。"); return;
    }
    const parsed = recordProgressEvidenceSchema.safeParse(draft.attempt ?? {
      nodeId: draft.nodeId, expectedVersion: draft.baseVersion, text: draft.text,
      artifactUrl: draft.artifactUrl.trim() || null, clientMutationId: crypto.randomUUID(),
    });
    if (!parsed.success) { setMessage("请选择路径节点，填写 1–8,000 字符的收获，并检查 HTTPS 作品链接（不可含账号密码）。"); return; }
    const attempt = parsed.data;
    inFlight.current = true; setBusy(true); setMessage("");
    // Persist the exact request BEFORE transport: a lost response must replay it,
    // never manufacture a new mutation ID after reload or edit the pending body.
    update({ ...draft, attempt });
    try {
      const result = await saveAction(attempt);
      if (!active.current) return;
      if (result.ok) {
        if (result.value.clientMutationId !== attempt.clientMutationId) throw new Error("Unexpected evidence receipt");
        setRecords((current) => [result.value, ...current.filter((entry) => entry.id !== result.value.id)].slice(0, 50));
        update({ ...blankDraft(blueprint.version), nodeId: draft.nodeId, nodeTitle: draft.nodeTitle });
        setMessage("记录已保存，仅自己可见。它不会自动将节点标记为完成。");
      } else if (result.code === "unauthenticated" || result.code === "forbidden") {
        setIdentityLost(true);
      } else if (result.code !== "unavailable") {
        update({ ...draft, attempt: undefined });
        setMessage(result.code === "version_conflict" || result.code === "not_found"
          ? "路径已经变化。草稿仍保留，请读取当前路径并重新确认关联节点。"
          : "记录未被接受。草稿仍保留，请检查文字与链接后再提交。");
      }
    } catch {
      // The server may have committed: retain the exact pending request.
    } finally {
      if (active.current) { setBusy(false); inFlight.current = false; }
    }
  }

  async function reload() {
    if (inFlight.current || identityLost) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await reloadAction();
      if (!active.current) return;
      if (result.ok && result.value.blueprint.id === initial.blueprint.id) {
        setBlueprint(result.value.blueprint);
        setHistoryUnavailable(!result.value.records.ok);
        if (result.value.records.ok) setRecords(result.value.records.value);
        setMessage("已读取当前路径；未提交的收获仍保留，版本变化需要重新确认。");
      } else if (!result.ok && (result.code === "forbidden" || result.code === "unauthenticated")) {
        setIdentityLost(true);
      } else setMessage("暂时无法读取。现有记录与草稿仍保留，可以稍后重试。");
    } catch {
      if (active.current) setMessage("暂时无法读取。现有记录与草稿仍保留，可以稍后重试。");
    } finally {
      if (active.current) { inFlight.current = false; setBusy(false); }
    }
  }

  if (identityLost) return <Panel className="evidence-compose"><Status tone="warning">账号或登录状态已变化。原账号草稿仍保留在本机，请重新登录原账号后继续。</Status><a className="bp-button" href="/progress">重新验证账号</a></Panel>;

  return <div className="evidence-layout">
    <Panel className="evidence-compose" aria-labelledby="evidence-compose-title">
      <div className="brand">Private field notes</div>
      <h2 id="evidence-compose-title">留下一次真实的进步</h2>
      <p className="subtle">仅自己可见。写下尝试、作品或仍未解决的问题；记录不等于已经掌握。</p>
      {storageWarning ? <Status tone="warning">{storageWarning}</Status> : null}
      {lockState === "elsewhere" ? <div><Status tone="warning">另一标签页正在编辑这个账号的草稿。本页只读，避免互相覆盖；关闭原标签页后可接手。</Status><Button disabled={busy} onClick={() => setLockAttempt((value) => value + 1)}>重新尝试编辑</Button></div> : null}
      {lockState === "unsupported" ? <Status tone="warning">浏览器无法提供安全的草稿编辑锁，当前仅可查看。请使用支持 Web Locks 的现代浏览器与安全连接。</Status> : null}
      {unreadableDraft !== null ? <div>
        <Status tone="warning">草稿格式无法识别，原内容未被覆盖。请先复制下方原文另行保存，再清除并重新填写。</Status>
        <label className="field"><span>原始恢复内容</span><textarea aria-label="无法识别的草稿" readOnly rows={7} value={unreadableDraft} /></label>
        <Button className="danger" disabled={!editable} onClick={() => {
          if (!editable) return;
          try { localStorage.removeItem(storageKey); setUnreadableDraft(null); setDraft(blankDraft(blueprint.version)); setStorageWarning(""); }
          catch { setStorageWarning("无法清除本机草稿，请先复制原文留存。"); }
        }}>已另行保存原文，清除损坏草稿</Button>
      </div> : draft ? <form onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
        <label className="field"><span>关联路径节点</span><select aria-label="关联路径节点" value={draft.nodeId} disabled={!editable || busy || Boolean(draft.attempt)}
          onChange={(event) => update({ ...draft, nodeId: event.target.value, nodeTitle: nodes.find((node) => node.id === event.target.value)?.title ?? "" })}>
          <option value="">选择本次学习或实践对应的节点</option>
          {draft.nodeId && !selectedExists ? <option value={draft.nodeId}>{draft.nodeTitle || "原节点"}（已不在当前路径）</option> : null}
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select></label>
        {nodes.length === 0 ? <Status>还没有可记录的正式节点。请先返回蓝图，确认一条学习、实践、检查点或复盘路径。</Status> : null}
        {versionChanged && !draft.attempt ? <div className="evidence-context-review"><Status tone="warning">草稿来自版本 {draft.baseVersion}，当前路径为版本 {blueprint.version}。请核对上方节点，再明确确认；收获正文不会自动修改。</Status>
          <Button type="button" disabled={!editable || busy || !selectedExists} onClick={() => { update({ ...draft, baseVersion: blueprint.version, nodeTitle: nodes.find((node) => node.id === draft.nodeId)?.title ?? draft.nodeTitle }); setMessage(""); }}>确认使用当前路径（版本 {blueprint.version}）</Button></div> : null}
        <label className="field"><span>这次的收获</span><textarea aria-label="这次的收获" aria-describedby="evidence-text-limit" rows={7} value={draft.text} readOnly={!editable || busy || Boolean(draft.attempt)}
          placeholder="我尝试了什么？有什么变化？下一次想改进什么？" onChange={(event) => update({ ...draft, text: event.target.value })} /></label>
        <p id="evidence-text-limit" className="subtle evidence-text-limit">{draft.text.length.toLocaleString("zh-CN")} / 8,000 字符</p>
        <label className="field"><span>作品链接 · 可选</span><input aria-label="作品链接" type="url" value={draft.artifactUrl} readOnly={!editable || busy || Boolean(draft.attempt)}
          placeholder="https://" onChange={(event) => update({ ...draft, artifactUrl: event.target.value })} /></label>
        <p className="subtle">外站作品可能公开，不受本应用的私人权限保护。</p>
        {!draft.attempt && draft.text ? <p className="subtle">当前文字尚未保存到云端；本机草稿仅用于短期恢复。</p> : null}
        {draft.attempt && !busy ? <Status tone="warning">尚不能确认是否保存。原提交与草稿已保留；请确认原提交结果后再编辑，避免生成重复记录。</Status> : null}
        {message ? <Status>{message}</Status> : null}
        <Button className="primary" disabled={!editable || busy || (!draft.attempt && (versionChanged || !selectedExists))} type="submit">{busy ? "正在处理…" : draft.attempt ? "确认原提交结果" : "保存私人记录"}</Button>
      </form> : <Status>正在恢复私人草稿…</Status>}
    </Panel>
    <Panel className="evidence-history" aria-labelledby="evidence-history-title">
      <div className="brand">Your trail</div><h2 id="evidence-history-title">最近的收获</h2>
      <p className="subtle">最近 50 条私人记录 · 保留提交当时的路径</p>
      <Button disabled={busy} onClick={() => void reload()}>读取当前路径与记录</Button>
      {historyUnavailable ? <Status tone="warning">暂时无法读取已有记录，这不表示记录为空。</Status> : null}
      {records.length === 0 && !historyUnavailable ? <div className="empty">还没有成果记录。一次尝试、一处发现，都是值得留下的起点。</div> : null}
      <ol className="evidence-timeline">{records.map((entry) => <li key={entry.id}><article>
        <time dateTime={entry.createdAt}>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(entry.createdAt))}（北京时间）</time>
        <h3>{entry.context.nodeTitle}</h3>
        <p className="subtle">{entry.context.goalTitle} / {entry.context.stageTitle} · 蓝图版本 {entry.context.blueprintVersion}</p>
        <p className="evidence-body">{entry.text}</p>
        {entry.artifactUrl ? recordProgressEvidenceSchema.shape.artifactUrl.safeParse(entry.artifactUrl).success
          ? <a href={entry.artifactUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开作品 ↗（外站，新标签页）</a>
          : <p className="subtle">链接格式无法安全打开：{entry.artifactUrl}</p> : null}
      </article></li>)}</ol>
    </Panel>
  </div>;
}
