"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { learningPositionSchema, parseLearningPositionWorkspace, recordLearningPositionSchema,
  type ApplicationResult, type LearningPosition, type LearningPositionWorkspace as PositionWorkspace } from "@blueprint/domain";
import { Button, Panel, Status } from "./index";

type Props = { accountId: string; initial: PositionWorkspace;
  saveAction: (input: unknown) => Promise<ApplicationResult<LearningPosition>>;
  reloadAction: (resourceBindingId?: string) => Promise<ApplicationResult<PositionWorkspace>>;
  automaticCaptureVideoId?: string | null;
  automaticCaptureBindingId?: string | null;
  capturePosition?: (videoId: string) => Promise<ApplicationResult<{ videoId: string; positionSeconds: number }>> };
const draftSchema = z.object({ schemaVersion: z.literal(1), version: z.int().nonnegative().max(2147483647), bindingId: z.string(), nodeId: z.string(),
  videoId: z.string(), label: z.string(), position: z.string(), positionVersion: z.int().nonnegative().max(2147483647),
  reviewRequired: z.boolean().optional(), attempt: recordLearningPositionSchema.optional() }).strict()
  .refine(draft => draft.bindingId === "" ? draft.nodeId === "" && draft.videoId === "" && !draft.attempt
    : z.uuid().safeParse(draft.bindingId).success && z.uuid().safeParse(draft.nodeId).success && /^[A-Za-z0-9_-]{11}$/.test(draft.videoId))
  .refine(draft => !draft.attempt || (draft.attempt.nodeId === draft.nodeId && draft.attempt.resourceBindingId === draft.bindingId
    && draft.attempt.expectedVersion === draft.version && draft.attempt.expectedPositionVersion === draft.positionVersion
    && /^\d+$/.test(draft.position) && draft.attempt.positionSeconds === Number(draft.position)));
type Draft = z.infer<typeof draftSchema>;
const blank = (version: number): Draft => ({ schemaVersion: 1, version, bindingId: "", nodeId: "", videoId: "", label: "", position: "", positionVersion: 0 });
function choices(workspace: PositionWorkspace) {
  return workspace.blueprint.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes.flatMap(node => node.resources.map(resource => ({ node, resource,
    label: `${goal.title} / ${stage.title} / ${node.title} · ${resource.externalId}` })))));
}
function mergePositions(previous: LearningPosition[], incoming: LearningPosition[]) {
  const latest = new Map(previous.map(record => [record.resource.bindingId, record]));
  for (const record of incoming) if ((latest.get(record.resource.bindingId)?.positionVersion ?? 0) < record.positionVersion) latest.set(record.resource.bindingId, record);
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(9, "0");
  return [...latest.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || fraction(b.createdAt).localeCompare(fraction(a.createdAt)) || b.id.localeCompare(a.id)).slice(0, 50);
}

export function LearningPositionWorkspace(props: Props) {
  return <Workspace key={`${props.accountId}:${props.initial.blueprint.id}`} {...props} />;
}
function Workspace({ accountId, initial, reloadAction, saveAction, capturePosition, automaticCaptureVideoId, automaticCaptureBindingId }: Props) {
  const [workspace, setWorkspace] = useState(initial), [draft, setDraft] = useState(() => blank(initial.blueprint.version));
  const [selection, setSelection] = useState(""), [candidate, setCandidate] = useState<PositionWorkspace | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [identityLost, setIdentityLost] = useState(false);
  const [unreadable, setUnreadable] = useState<string | null>(null), [storageFailed, setStorageFailed] = useState(false), [warning, setWarning] = useState("");
  const [lock, setLock] = useState<"pending" | "owned" | "elsewhere" | "unsupported">("pending"), [lockAttempt, setLockAttempt] = useState(0);
  const active = useRef(false), flight = useRef(false), epoch = useRef(0);
  const surface = useRef<HTMLElement>(null), automaticRunning = useRef(false), automaticEpoch = useRef(0);
  const [automatic, setAutomatic] = useState(false);
  const tick = useRef<() => Promise<void>>(async () => {});
  const visible = () => document.visibilityState !== "hidden" && Boolean(surface.current) && !surface.current!.closest("[hidden]");
  function stopAutomatic() {
    if (automaticRunning.current) setMessage("自动保存已停止；已发送的请求仍可能完成，不会自动重新开启。");
    automaticRunning.current = false; ++automaticEpoch.current; setAutomatic(false);
  }
  useEffect(() => { stopAutomatic(); }, [automaticCaptureVideoId, automaticCaptureBindingId]);
  useEffect(() => {
    if (!automatic) return;
    const checkVisibility = () => { if (!visible()) stopAutomatic(); };
    const observer = new MutationObserver(checkVisibility);
    observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["hidden"] });
    document.addEventListener("visibilitychange", checkVisibility);
    window.addEventListener("pagehide", stopAutomatic);
    const timer = setInterval(() => { void tick.current(); }, 30_000);
    checkVisibility();
    return () => { clearInterval(timer); observer.disconnect(); document.removeEventListener("visibilitychange", checkVisibility); window.removeEventListener("pagehide", stopAutomatic); };
  }, [automatic]);
  const storageKey = `blueprint-learning-position:v1:${accountId}:${initial.blueprint.id}`;
  useEffect(() => {
    active.current = true; ++epoch.current; let cancelled = false, release: (() => void) | undefined;
    function restore() {
      setStorageFailed(false); setUnreadable(null); setCandidate(null);
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw === null) setDraft(blank(initial.blueprint.version));
        else { try { const restored = draftSchema.parse(JSON.parse(raw)); setDraft({ ...restored, reviewRequired: !restored.attempt }); setSelection(restored.bindingId); } catch { setUnreadable(raw); } }
      } catch { setStorageFailed(true); }
    }
    setLock("pending");
    if (!navigator.locks) { restore(); setLock("unsupported"); }
    else void Promise.resolve().then(() => {
      if (cancelled) return;
      return navigator.locks.request(storageKey, { ifAvailable: true }, async held => {
        if (cancelled) return; restore();
        if (!held) { setLock("elsewhere"); return; }
        const lifetime = new Promise<void>(resolve => { release = resolve; }); setLock("owned"); await lifetime;
      });
    }).catch(() => { if (!cancelled) { restore(); setLock("unsupported"); } });
    return () => { cancelled = true; active.current = false; automaticRunning.current = false; ++automaticEpoch.current; ++epoch.current; release?.(); };
  }, [storageKey, lockAttempt]);
  function persist(next: Draft) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next); setWarning(""); return true; }
    catch { setWarning("无法保存本机恢复信息，请先复制当前输入并恢复浏览器存储。"); return false; }
  }
  const editable = lock === "owned" && unreadable === null && !storageFailed, frozen = busy || automatic || Boolean(draft.attempt) || !editable;
  const currentChoices = choices(workspace), selected = candidate && choices(candidate).find(item => item.resource.id === selection);
  const latest = candidate?.records[0];
  const matching = selected && latest?.context.nodeId === selected.node.id && latest.resource.videoId === selected.resource.externalId;
  const sourceChanged = draft.version !== workspace.blueprint.version || Boolean(draft.bindingId && !currentChoices.some(item => item.resource.id === draft.bindingId
    && item.node.id === draft.nodeId && item.resource.externalId === draft.videoId));
  async function read(bindingId: string | null = selection) {
    if (flight.current || identityLost || (bindingId !== null && (!bindingId || draft.attempt || !editable))) return;
    const generation = epoch.current; flight.current = true; setBusy(true); setMessage(""); setCandidate(null);
    try {
      const result = await reloadAction(bindingId ?? undefined); if (!active.current || generation !== epoch.current) return;
      if (!result.ok) { if (result.code === "unauthenticated" || result.code === "forbidden") setIdentityLost(true); throw new Error("Unavailable"); }
      const value = parseLearningPositionWorkspace(result.value);
      if (value.blueprint.id !== initial.blueprint.id || value.blueprint.version < workspace.blueprint.version
        || (bindingId !== null && value.records.some(record => record.resource.bindingId !== bindingId))
        || value.records.some(record => (workspace.records.find(known => known.resource.bindingId === record.resource.bindingId)?.positionVersion ?? 0) > record.positionVersion)) throw new Error("Invalid source");
      setWorkspace(previous => ({ blueprint: value.blueprint, records: mergePositions(previous.records, value.records) }));
      if (bindingId !== null) setCandidate(value); else setMessage("已读取最新学习位置；本机草稿与原提交不变。");
    } catch { if (active.current && generation === epoch.current) setMessage("暂时无法读取所选视频的位置，原输入保留。"); }
    finally { if (active.current && generation === epoch.current) { flight.current = false; setBusy(false); } }
  }
  function confirm() {
    if (!candidate || !selected) return;
    const same = draft.bindingId === selected.resource.id && draft.nodeId === selected.node.id && draft.videoId === selected.resource.externalId;
    if (!editable || draft.attempt || identityLost || flight.current) return;
    if (persist({ schemaVersion: 1, version: candidate.blueprint.version, bindingId: selected.resource.id, nodeId: selected.node.id, videoId: selected.resource.externalId, label: selected.label,
      positionVersion: latest?.positionVersion ?? 0, position: same ? draft.position : matching ? String(latest.positionSeconds) : "" })) {
      setCandidate(null); setMessage("已确认来源与位置版本；填写或读取位置后再保存。");
    }
  }
  async function capture() {
    if (!capturePosition || flight.current || frozen || sourceChanged || draft.reviewRequired || !draft.bindingId || identityLost) return;
    const generation = epoch.current; flight.current = true; setBusy(true); setMessage("正在读取当前播放位置…");
    try {
      const result = await capturePosition(draft.videoId); if (!active.current || generation !== epoch.current) return;
      if (!result.ok) { if (result.code === "unauthenticated" || result.code === "forbidden") setIdentityLost(true); throw new Error("Player unavailable"); }
      const position = result.value;
      if (!position || position.videoId !== draft.videoId || !Number.isInteger(position.positionSeconds) || position.positionSeconds < 0 || position.positionSeconds > 2147483647) throw new Error("Invalid player position");
      const next = { ...draft, position: String(position.positionSeconds) }; setDraft(next); persist(next);
      setMessage("已填入当前播放位置，尚未保存；不会自动记录观看或掌握。");
    } catch { if (active.current && generation === epoch.current) setMessage("无法读取当前视频位置。请确认是所选视频且不在广告或加载中；原位置保留，也可手动填写。"); }
    finally { if (active.current && generation === epoch.current) { flight.current = false; setBusy(false); } }
  }
  async function save(inputDraft = draft, automatically = false) {
    const draft = inputDraft;
    if (flight.current || !draft.bindingId || !editable || identityLost || (!draft.attempt && (draft.reviewRequired || sourceChanged))) return;
    const generation = epoch.current;
    const command = recordLearningPositionSchema.safeParse(draft.attempt ?? { nodeId: draft.nodeId, resourceBindingId: draft.bindingId, expectedVersion: draft.version,
      expectedPositionVersion: draft.positionVersion, positionSeconds: /^\d+$/.test(draft.position) ? Number(draft.position) : NaN, clientMutationId: crypto.randomUUID() });
    if (!command.success) { setMessage("请填写非负整数秒，零秒表示视频开头。"); return; }
    if (!persist({ ...draft, attempt: command.data })) { if (automatically) stopAutomatic(); setMessage("尚未发送：无法持久保存原请求。"); return; }
    flight.current = true; setBusy(true);
    try {
      const result = await saveAction(command.data); if (!active.current || generation !== epoch.current) return;
      if (!result.ok) {
        if (automatically) stopAutomatic();
        if (result.code === "unauthenticated" || result.code === "forbidden") { setIdentityLost(true); return; }
        if (["invalid", "not_found", "version_conflict"].includes(result.code)) {
          persist({ ...draft, attempt: undefined, reviewRequired: true }); setCandidate(null);
          setMessage("本次保存已被拒绝，原位置保留。请重新读取所选视频并核对最新记录，不会自动覆盖。"); return;
        }
        throw new Error("Unavailable");
      }
      const receipt = learningPositionSchema.parse(result.value), sent = command.data;
      if (receipt.context.blueprintId !== initial.blueprint.id || receipt.context.nodeId !== sent.nodeId || receipt.context.blueprintVersion !== sent.expectedVersion
        || receipt.resource.bindingId !== sent.resourceBindingId || receipt.resource.videoId !== draft.videoId || receipt.clientMutationId !== sent.clientMutationId
        || receipt.expectedPositionVersion !== sent.expectedPositionVersion || receipt.positionSeconds !== sent.positionSeconds) throw new Error("Invalid receipt");
      setWorkspace(previous => ({ ...previous, records: mergePositions(previous.records, [receipt]) }));
      const next = automatically ? { ...draft, attempt: undefined, positionVersion: receipt.positionVersion } : blank(workspace.blueprint.version);
      const stored = persist(next);
      if (!stored && automatically) stopAutomatic();
      setMessage(stored ? "位置已保存" : "云端位置已保存，但本机恢复信息尚未清理；可以核对原提交。");
    } catch { if (active.current && generation === epoch.current) { if (automatically) stopAutomatic(); setMessage("尚未确认保存结果，请核对原位置提交；不会自动重发。"); } }
    finally { if (active.current && generation === epoch.current) { flight.current = false; setBusy(false); } }
  }
  const unchangedInput = draft.position === "" || workspace.records.some(record => record.resource.bindingId === draft.bindingId
    && record.resource.videoId === draft.videoId && record.context.nodeId === draft.nodeId
    && record.positionVersion === draft.positionVersion && String(record.positionSeconds) === draft.position);
  const canStartAutomatic = Boolean(capturePosition && automaticCaptureVideoId === draft.videoId && automaticCaptureBindingId === draft.bindingId && draft.bindingId && selection === draft.bindingId
    && editable && !busy && !draft.attempt && !draft.reviewRequired && !sourceChanged && !identityLost && unchangedInput);
  useEffect(() => {
    tick.current = async () => {
      if (!automaticRunning.current || flight.current) return;
      if (!canStartAutomatic || !visible() || !capturePosition) { stopAutomatic(); return; }
      const generation = epoch.current, tracking = automaticEpoch.current;
      flight.current = true; setBusy(true);
      try {
        const result = await capturePosition(draft.videoId);
        if (!active.current || generation !== epoch.current) return;
        if (!automaticRunning.current || tracking !== automaticEpoch.current || !visible()) { stopAutomatic(); return; }
        if (!result.ok) {
          if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
          throw new Error("Player unavailable");
        }
        const position = result.value;
        if (position.videoId !== draft.videoId || !Number.isInteger(position.positionSeconds) || position.positionSeconds < 0 || position.positionSeconds > 2147483647) throw new Error("Invalid position");
        if (draft.position === String(position.positionSeconds)) return;
        flight.current = false;
        await save({ ...draft, position: String(position.positionSeconds) }, true);
      } catch {
        if (active.current && generation === epoch.current) { stopAutomatic(); setMessage("自动保存已停止：无法确认当前视频位置。原输入保留，可手动读取或保存。"); }
      } finally { if (active.current && generation === epoch.current) { flight.current = false; setBusy(false); } }
    };
  });
  if (identityLost) return <Status tone="warning">账号或登录状态已变化，私人位置已隐藏。原账号的恢复草稿仍保留。</Status>;
  return <section ref={surface} className="position-workspace" aria-label="继续学习工作台">
    <div className="position-toolbar"><span>当前路径版本 {workspace.blueprint.version}</span><Button disabled={busy || automatic || lock === "pending"} onClick={() => void read(null)}>读取最新学习位置</Button></div>
    {lock === "elsewhere" ? <Status tone="warning">另一标签页正在编辑位置，这里仅可查看。</Status> : null}
    {lock === "unsupported" ? <Status tone="warning">无法取得安全编辑锁，仅可查看；请使用支持 Web Locks 的浏览器。</Status> : null}
    {lock === "elsewhere" || storageFailed ? <Button disabled={busy} onClick={() => setLockAttempt(value => value + 1)}>重新尝试编辑位置</Button> : null}
    <Panel className="position-compose"><p className="position-eyebrow">NEXT SESSION / 下一次学习</p><h2>从你停下的地方继续</h2>
      <p className="subtle">位置只用于定位，不代表观看时长、完成或掌握。先选择节点下的视频并核对云端记录，{automaticCaptureVideoId !== undefined ? "再手动保存或主动开启自动保存。" : "再明确保存。"}</p>
      {unreadable !== null ? <div><Status tone="warning">恢复信息无法解析。请先复制原内容，再明确重置。</Status><textarea aria-label="原始位置恢复内容" readOnly value={unreadable} />
        <Button disabled={busy || lock !== "owned"} onClick={() => { if (persist(blank(workspace.blueprint.version))) setUnreadable(null); }}>已另行保存，重置位置草稿</Button></div> : null}
      {storageFailed ? <Status tone="warning">无法读取本机恢复信息，已停止编辑；请恢复存储后重新打开。</Status> : null}
      <label>关联视频<select aria-label="继续学习关联视频" value={selection} disabled={frozen} onChange={event => { setSelection(event.target.value); setCandidate(null); }}>
        <option value="">请选择节点下的视频</option>{currentChoices.map(item => <option key={item.resource.id} value={item.resource.id}>{item.label}</option>)}
      </select></label>
      <Button disabled={frozen || !selection} onClick={() => void read()}>读取所选视频位置</Button>
      {candidate ? <div className="position-comparison"><h3>先核对，再继续编辑</h3>
        <p>{selected?.label ?? "原路径来源已不可用，不能新增保存。"}</p>
        {latest ? <p>云端保存：{latest.positionSeconds} 秒 · 位置版本 {latest.positionVersion}{!matching ? " · 属于历史来源，不自动用于当前视频" : ""}</p> : <p>此资源尚未保存位置</p>}
        <Button disabled={frozen || !selected} onClick={confirm}>使用此来源与最新位置版本</Button>
      </div> : null}
      {draft.bindingId ? <p className="position-source">本机输入：{draft.label} · 路径版本 {draft.version} · 位置版本 {draft.positionVersion}</p> : null}
      <label>下次继续的位置（秒）<input aria-label="继续学习位置（秒）" inputMode="numeric" disabled={frozen || !draft.bindingId} value={draft.position} onChange={event => { const next = { ...draft, position: event.target.value }; setDraft(next); persist(next); }} /></label>
      {capturePosition ? <Button disabled={frozen || sourceChanged || draft.reviewRequired || !draft.bindingId} onClick={() => void capture()}>读取当前播放位置</Button> : null}
      {capturePosition && automaticCaptureVideoId !== undefined ? <div className="position-automatic">
        <p className="subtle">仅本次主动开启后，每 30 秒保存当前视频变化的位置。离开此面板、切换视频或出错即停止，不会自动恢复；已经发送的保存可能仍会完成。</p>
        {automaticCaptureVideoId !== draft.videoId || automaticCaptureBindingId !== draft.bindingId ? <p className="subtle">自动保存仅适用于当前学习上下文中的同一节点和视频，请先选择并确认对应来源。</p> : null}
        {!unchangedInput ? <p className="subtle">请先保存或清空手动输入，再开启自动保存。</p> : null}
        <Button aria-pressed={automatic} disabled={!automatic && !canStartAutomatic} onClick={() => {
          if (automaticRunning.current) stopAutomatic();
          else if (canStartAutomatic && visible()) { ++automaticEpoch.current; automaticRunning.current = true; setAutomatic(true); setMessage("自动保存已开启；只记录定位秒数，不推算学习进度。"); }
        }}>{automatic ? "停止自动保存位置" : "开启自动保存位置"}</Button>
      </div> : null}
      {(draft.reviewRequired || sourceChanged) && !draft.attempt ? <Status tone="warning">请先读取所选视频并明确确认最新来源与位置版本；原输入仍保留。</Status> : null}
      <Button disabled={busy || automatic || !editable || !draft.bindingId || (!draft.attempt && (draft.reviewRequired || sourceChanged))} onClick={() => void save()}>{draft.attempt ? "确认原位置提交" : "保存继续学习位置"}</Button>
      {warning ? <Status tone="warning">{warning}</Status> : null}
      {message ? <Status>{message}</Status> : null}
    </Panel>
    <section className="position-history" aria-label="已保存的学习位置"><h2>为下一次保留的起点</h2><p className="subtle">最近 50 个资源的最新位置。更早的视频可从关联列表按需读取。</p>
      {workspace.records.length === 0 ? <Panel><p>还没有保存的位置。你可以从零秒开始，也可以手动填写。</p></Panel> : workspace.records.map(record => <Panel key={record.id}>
        <p>{record.context.goalTitle} / {record.context.stageTitle} / {record.context.nodeTitle}</p>
        <p className="position-time">{record.positionSeconds}<span> 秒</span></p>
        <p className="subtle">位置版本 {record.positionVersion} · 保存于 {record.createdAt.slice(0, 10)}</p>
        {!currentChoices.some(item => item.resource.id === record.resource.bindingId && item.node.id === record.context.nodeId && item.resource.externalId === record.resource.videoId)
          ? <p>历史来源已改变或移除；下面只打开原视频。</p> : null}
        <a className="bp-button" target="_blank" rel="noopener noreferrer" href={`https://www.youtube.com/watch?v=${record.resource.videoId}&t=${record.positionSeconds}s`}>打开原视频 · {record.positionSeconds} 秒</a>
      </Panel>)}
    </section>
  </section>;
}
