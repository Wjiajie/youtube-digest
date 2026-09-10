"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { learningNoteSchema, parseBlueprintSnapshot, recordLearningNoteSchema, type ApplicationResult, type LearningNote, type LearningNoteWorkspace } from "@blueprint/domain";
import { Button, Panel, Status } from "./index";

type Props = { accountId: string; initial: LearningNoteWorkspace;
  saveAction: (input: unknown) => Promise<ApplicationResult<LearningNote>>;
  reloadAction: () => Promise<ApplicationResult<LearningNoteWorkspace>>;
  capturePosition?: (videoId: string) => Promise<ApplicationResult<{ videoId: string; positionSeconds: number }>> };
const draftSchema = z.object({ schemaVersion: z.literal(1), version: z.int().nonnegative(), bindingId: z.string(), nodeId: z.string(),
  label: z.string(), videoId: z.string(), text: z.string(), position: z.string(), reviewRequired: z.boolean().optional(), attempt: recordLearningNoteSchema.optional() }).strict()
  .refine(draft => draft.bindingId === "" ? draft.nodeId === "" && draft.videoId === "" && !draft.attempt
    : z.uuid().safeParse(draft.bindingId).success && z.uuid().safeParse(draft.nodeId).success && /^[A-Za-z0-9_-]{11}$/.test(draft.videoId))
  .refine(draft => !draft.attempt || (draft.attempt.nodeId === draft.nodeId && draft.attempt.resourceBindingId === draft.bindingId
    && draft.attempt.expectedVersion === draft.version && draft.attempt.text === draft.text
    && draft.attempt.positionSeconds === (draft.position === "" ? null : Number(draft.position))));
type Draft = z.infer<typeof draftSchema>;
const blank = (version: number): Draft => ({ schemaVersion: 1, version, bindingId: "", nodeId: "", label: "", videoId: "", text: "", position: "" });
function recentFirst(a: LearningNote, b: LearningNote) {
  // Date.parse handles offsets; fractional comparison retains PostgreSQL microseconds.
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(9, "0");
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || fraction(b.createdAt).localeCompare(fraction(a.createdAt)) || b.id.localeCompare(a.id);
}

export function NotesWorkspace(props: Props) {
  return <Workspace key={`${props.accountId}:${props.initial.blueprint.id}`} {...props} />;
}
function Workspace({ accountId, initial, saveAction, reloadAction, capturePosition }: Props) {
  const [blueprint, setBlueprint] = useState(initial.blueprint);
  const [draft, setDraft] = useState(() => blank(initial.blueprint.version));
  const [records, setRecords] = useState(initial.records), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [warning, setWarning] = useState("");
  const [unreadable, setUnreadable] = useState<string | null>(null), [readFailed, setReadFailed] = useState(false);
  const [lock, setLock] = useState<"pending" | "owned" | "elsewhere" | "unsupported">("pending"), [lockAttempt, setLockAttempt] = useState(0);
  const [needsRead, setNeedsRead] = useState(false), [identityLost, setIdentityLost] = useState(false);
  const active = useRef(false), inFlight = useRef(false), epoch = useRef(0);
  const reloadRef = useRef(reloadAction); reloadRef.current = reloadAction;
  const storageKey = `blueprint-learning-note:v1:${accountId}:${initial.blueprint.id}`;
  useEffect(() => {
    active.current = true; const generation = ++epoch.current; let cancelled = false, release: (() => void) | undefined;
    function restore() {
      try {
        const raw = localStorage.getItem(storageKey); setReadFailed(false); setUnreadable(null); setWarning("");
        if (raw === null) setDraft(blank(initial.blueprint.version));
        else { try { const restored = draftSchema.parse(JSON.parse(raw)); setDraft(restored); if (restored.reviewRequired) setNeedsRead(true); } catch { setUnreadable(raw); } }
      } catch { setReadFailed(true); setWarning("无法读取本机草稿，已停止编辑；原内容不会被覆盖。"); }
    }
    setLock("pending");
    if (!navigator.locks) { restore(); setLock("unsupported"); }
    else void Promise.resolve().then(() => {
      if (cancelled) return;
      return navigator.locks.request(storageKey, { ifAvailable: true }, async held => {
        if (cancelled) return; restore();
        if (!held) { setLock("elsewhere"); return; }
        const lifetime = new Promise<void>(resolve => { release = resolve; });
        setLock("owned");
        if (lockAttempt > 0) { setNeedsRead(true); void reload(generation); }
        await lifetime;
      });
    }).catch(() => { if (!cancelled) { restore(); setLock("unsupported"); } });
    return () => { cancelled = true; active.current = false; ++epoch.current; release?.(); };
  }, [storageKey, lockAttempt]);
  function persist(next: Draft) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next); setWarning(""); return true; }
    catch { setWarning("无法保存本机恢复草稿，请复制原文留存并恢复浏览器存储。"); return false; }
  }
  function edit(next: Draft) { setDraft(next); persist(next); setMessage(""); }
  const editable = lock === "owned" && unreadable === null && !readFailed;
  const frozen = busy || Boolean(draft.attempt) || !editable;
  const choices = blueprint.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes.flatMap(node =>
    node.resources.map(resource => ({ node, resource, label: `${goal.title} / ${stage.title} / ${node.title} · ${resource.externalId}` })))));
  const source = choices.find(item => item.resource.id === draft.bindingId && item.node.id === draft.nodeId && item.resource.externalId === draft.videoId);
  const changed = draft.version !== blueprint.version || Boolean(draft.bindingId && !source);
  async function capture() {
    if (!capturePosition || inFlight.current || frozen || changed || needsRead || draft.reviewRequired || !source || identityLost) return;
    const generation = epoch.current;
    inFlight.current = true; setBusy(true); setMessage("正在读取当前播放位置…");
    try {
      const result = await capturePosition(draft.videoId);
      if (!active.current || generation !== epoch.current) return;
      if (!result.ok) {
        if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
        throw new Error("Player unavailable");
      }
      const position = result.value;
      if (position.videoId !== draft.videoId || !Number.isInteger(position.positionSeconds) || position.positionSeconds < 0 || position.positionSeconds > 2147483647) throw new Error("Invalid position");
      edit({ ...draft, position: String(position.positionSeconds) });
      setMessage("已填入当前播放位置，尚未保存笔记；这不是观看或掌握证明。");
    } catch { if (active.current && generation === epoch.current) setMessage("无法读取位置。请确认当前标签页正在播放所选视频，且不在广告或加载中；原位置保留，也可手动填写。"); }
    finally { if (active.current && generation === epoch.current) { inFlight.current = false; setBusy(false); } }
  }
  async function reload(generation = epoch.current) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true);
    try {
      const result = await reloadRef.current(); if (!active.current || generation !== epoch.current) return;
      if (!result.ok) {
        if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
        throw new Error("Read unavailable");
      }
      const current = parseBlueprintSnapshot(result.value.blueprint), notes = result.value.records.map(note => learningNoteSchema.parse(note));
      if (current.id !== initial.blueprint.id || current.version < blueprint.version || notes.length > 50
        || new Set(notes.map(note => note.id)).size !== notes.length || new Set(notes.map(note => note.clientMutationId)).size !== notes.length
        || notes.some(note => note.context.blueprintId !== current.id || note.context.blueprintVersion > current.version)) throw new Error("Incoherent workspace");
      setBlueprint(current); setRecords(notes); setNeedsRead(false); setMessage("已读取最新笔记；原草稿与来源不会自动改变。");
    } catch { if (active.current && generation === epoch.current) setMessage("暂时无法读取最新笔记，原草稿与记录保留。"); }
    finally { if (active.current && generation === epoch.current) { inFlight.current = false; setBusy(false); } }
  }
  async function save() {
    if (inFlight.current || !editable || identityLost || (!draft.attempt && (needsRead || changed || draft.reviewRequired || !source))) return;
    const generation = epoch.current;
    const command = recordLearningNoteSchema.safeParse(draft.attempt ?? { nodeId: draft.nodeId, resourceBindingId: draft.bindingId, text: draft.text,
      positionSeconds: draft.position === "" ? null : /^\d+$/.test(draft.position) ? Number(draft.position) : NaN,
      expectedVersion: draft.version, clientMutationId: crypto.randomUUID() });
    if (!command.success) { setMessage("请核对视频、正文和位置。"); return; }
    if (!persist({ ...draft, attempt: command.data })) { setMessage("尚未发送：无法持久保存原请求。"); return; }
    inFlight.current = true; setBusy(true);
    try {
      const result = await saveAction(command.data); if (!active.current || generation !== epoch.current) return;
      if (result.ok) {
        const note = learningNoteSchema.parse(result.value), sent = command.data;
        if (note.context.blueprintId !== initial.blueprint.id || note.context.nodeId !== sent.nodeId || note.context.blueprintVersion !== sent.expectedVersion
          || note.resource.bindingId !== sent.resourceBindingId || note.resource.videoId !== draft.videoId || note.clientMutationId !== sent.clientMutationId
          || note.text !== sent.text || note.positionSeconds !== sent.positionSeconds) throw new Error("Incoherent receipt");
        setRecords(previous => [note, ...previous.filter(item => item.id !== note.id)].sort(recentFirst).slice(0, 50));
        setMessage(persist(blank(blueprint.version)) ? "笔记已保存" : "云端笔记已保存，但本机恢复信息尚未清理；可以核对原提交。");
      } else if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
      else if (["invalid", "version_conflict", "not_found"].includes(result.code)) {
        if (persist({ ...draft, attempt: undefined, reviewRequired: true })) setNeedsRead(true);
        setMessage("本次提交已被拒绝，原文保留。请读取当前路径并明确重新关联后再保存。");
      } else setMessage("尚未确认保存结果，请确认原笔记提交；不会自动重发。");
    } catch { if (active.current && generation === epoch.current) setMessage("尚未确认保存结果，请确认原笔记提交；不会自动重发。"); }
    finally { if (active.current && generation === epoch.current) { inFlight.current = false; setBusy(false); } }
  }
  if (identityLost) return <Status tone="warning">账号或登录状态已变化，请重新登录。原账号的笔记草稿仍保留。</Status>;
  return <section className="note-workspace" aria-label="私人视频笔记">
    <div className="note-toolbar"><span>当前路径版本 {blueprint.version}</span><Button disabled={busy || lock === "pending"} onClick={() => void reload()}>读取最新笔记</Button></div>
    {lock === "elsewhere" ? <Status tone="warning">另一标签页正在编辑这份笔记，这里仅可查看。</Status> : null}
    {lock === "unsupported" ? <Status tone="warning">无法取得安全编辑锁，仅可查看；请使用支持 Web Locks 的浏览器。</Status> : null}
    {lock === "elsewhere" || readFailed ? <Button disabled={busy} onClick={() => setLockAttempt(value => value + 1)}>重新尝试编辑笔记</Button> : null}
    <Panel className="note-compose"><h2>留住这一刻的想法</h2>
      <p className="subtle">笔记属于你选择的节点与视频，不自动证明已经观看或掌握。</p>
      {unreadable !== null ? <div className="note-recovery"><Status tone="warning">恢复信息无法解析。先复制原内容留存，再明确重置。</Status>
        <textarea aria-label="原始笔记恢复内容" readOnly value={unreadable} />
        <Button disabled={busy || lock !== "owned"} onClick={() => { if (persist(blank(blueprint.version))) { setUnreadable(null); setNeedsRead(false); } }}>已另行保存原文，重置笔记草稿</Button>
      </div> : null}
      <label>关联视频<select aria-label="笔记关联视频" disabled={frozen} value={draft.bindingId} onChange={event => {
        const selected = choices.find(item => item.resource.id === event.target.value);
        edit({ ...draft, bindingId: selected?.resource.id ?? "", nodeId: selected?.node.id ?? "", label: selected?.label ?? "", videoId: selected?.resource.externalId ?? "" });
      }}>
        <option value="">请选择节点下的视频</option>{choices.map(item => <option key={item.resource.id} value={item.resource.id}>{item.label}</option>)}
        {draft.bindingId && !source ? <option value={draft.bindingId} disabled>{draft.label}（原来源不可用）</option> : null}
      </select></label>
      {draft.bindingId ? <p className="note-source">草稿来源：{draft.label} · 路径版本 {draft.version}</p> : null}
      <label>笔记原文<textarea aria-label="笔记原文" disabled={frozen} value={draft.text} onChange={event => edit({ ...draft, text: event.target.value })} rows={6} /></label>
      <span className="subtle">{Array.from(draft.text).length} / 8000 字符 · 仅自己可见</span>
      <label>视频位置（秒，可选）<input aria-label="视频位置（秒，可选）" disabled={frozen} inputMode="numeric" value={draft.position} onChange={event => edit({ ...draft, position: event.target.value })} /></label>
      {capturePosition ? <Button disabled={frozen || changed || needsRead || draft.reviewRequired || !source} onClick={() => void capture()}>读取当前播放位置</Button> : null}
      <p className="subtle">填写非负整数秒，留空表示不指定位置；这不是自动记录的观看进度。</p>
      {changed ? <Status tone="warning">草稿来源与当前路径不同，请读取后明确重新关联；原提交仍可原样核对。</Status> : null}
      {!draft.attempt && (changed || draft.reviewRequired) ? <Button disabled={busy || !editable || needsRead || !source} onClick={() => {
        if (source) persist({ ...draft, version: blueprint.version, label: source.label, reviewRequired: false });
      }}>按当前路径重新关联</Button> : null}
      <Button disabled={busy || !editable || (!draft.attempt && (changed || needsRead || draft.reviewRequired || !source))} onClick={() => void save()}>{draft.attempt ? "确认原笔记提交" : "保存笔记"}</Button>
      {warning ? <Status tone="warning">{warning}</Status> : null}{message ? <Status>{message}</Status> : null}
    </Panel>
    <section className="note-history" aria-label="笔记历史"><h2>最近的笔记</h2><p className="subtle">最多显示最近 50 条，不是完整导出。</p>
      {records.length === 0 ? <p>尚无视频笔记</p> : records.map(note => <Panel key={note.id}>
        <p>{note.context.goalTitle} / {note.context.stageTitle} / {note.context.nodeTitle}</p>
        <p className="subtle">保存时路径版本 {note.context.blueprintVersion} · <time dateTime={note.createdAt}>{note.createdAt.slice(0, 10)}</time></p>
        {!choices.some(item => item.resource.id === note.resource.bindingId && item.node.id === note.context.nodeId && item.resource.externalId === note.resource.videoId) ? <p className="subtle">原路径来源已不可用，保留保存时的记录。</p> : null}
        <p className="note-text">{note.text}</p>
        <a className="bp-button" target="_blank" rel="noopener noreferrer" href={`https://www.youtube.com/watch?v=${note.resource.videoId}${note.positionSeconds === null ? "" : `&t=${note.positionSeconds}s`}`}>打开视频{note.positionSeconds === null ? "" : ` · ${note.positionSeconds} 秒`}</a>
      </Panel>)}
    </section>
  </section>;
}
