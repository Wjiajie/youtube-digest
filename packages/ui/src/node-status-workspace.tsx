"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { confirmNodeStatusSchema, nodeStatusRecordSchema, NODE_STATUSES, type ApplicationResult, type NodeStatus,
  type NodeStatusRecord, type NodeStatusWorkspace } from "@blueprint/domain";
import { Button, Panel, Status } from "./index";

type Props = { accountId: string; initial: NodeStatusWorkspace;
  saveAction: (input: unknown) => Promise<ApplicationResult<NodeStatusRecord>>;
  reloadAction: () => Promise<ApplicationResult<NodeStatusWorkspace>> };
const labels: Record<NodeStatus, string> = { not_started: "尚未开始", in_progress: "进行中", completed: "自我确认完成" };
const kinds = { learn: "学习", practice: "实践", checkpoint: "检查点", reflection: "复盘" };
const selectionSchema = z.object({ schemaVersion: z.literal(1), nodeId: z.string(), nodeTitle: z.string(),
  expectedVersion: z.int().nonnegative(), expectedStatusRevision: z.int().nonnegative(), status: z.enum(NODE_STATUSES),
  evidenceId: z.uuid().nullable(), acknowledged: z.boolean(), completionCriteria: z.string(), estimatedMinutes: z.int().positive().nullable(),
  attempt: confirmNodeStatusSchema.optional() }).strict().refine(value => !value.attempt || (
    value.attempt.nodeId === value.nodeId && value.attempt.expectedVersion === value.expectedVersion &&
    value.attempt.expectedStatusRevision === value.expectedStatusRevision && value.attempt.status === value.status &&
    (value.attempt.evidenceId ?? null) === value.evidenceId && (value.status !== "completed" || value.acknowledged)));
type Selection = z.infer<typeof selectionSchema>;
function emptySelection(version: number): Selection {
  return { schemaVersion: 1, nodeId: "", nodeTitle: "", expectedVersion: version, expectedStatusRevision: 0,
    status: "not_started", evidenceId: null, acknowledged: false, completionCriteria: "", estimatedMinutes: null };
}

export function NodeStatusWorkspacePanel(props: Props) {
  return <Workspace key={`${props.accountId}:${props.initial.blueprint.id}`} {...props} />;
}

function Workspace({ accountId, initial, saveAction, reloadAction }: Props) {
  const [workspace, setWorkspace] = useState(initial);
  const [selection, setSelection] = useState(() => emptySelection(initial.blueprint.version));
  const [busy, setBusy] = useState(false), [identityLost, setIdentityLost] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const active = useRef(false);
  const storageKey = `blueprint-node-status:v1:${accountId}:${initial.blueprint.id}`;
  const [storageWarning, setStorageWarning] = useState("");
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [lockState, setLockState] = useState<"pending" | "owned" | "elsewhere" | "unsupported">("pending");
  const [lockAttempt, setLockAttempt] = useState(0);
  const [needsRead, setNeedsRead] = useState(false);
  const reloadRef = useRef(reloadAction); reloadRef.current = reloadAction;
  const initialVersion = useRef(initial.blueprint.version).current;
  useEffect(() => {
    active.current = true;
    let cancelled = false, release: (() => void) | undefined;
    function restore() {
      try {
        const raw = localStorage.getItem(storageKey);
        setReadFailed(false); setUnreadable(null); setStorageWarning("");
        if (raw === null) setSelection(emptySelection(initialVersion));
        else {
          try { const parsed = selectionSchema.safeParse(JSON.parse(raw));
            if (parsed.success) setSelection(parsed.data); else setUnreadable(raw);
          } catch { setUnreadable(raw); }
        }
      } catch { setReadFailed(true); setStorageWarning("无法读取本机恢复信息，已停止编辑；原内容不会被覆盖。"); }
    }
    setLockState("pending");
    if (!navigator.locks) { restore(); setLockState("unsupported"); }
    else void Promise.resolve().then(() => {
      if (cancelled) return;
      return navigator.locks.request(storageKey, { ifAvailable: true }, async lock => {
        if (cancelled) return;
        restore();
        if (!lock) { setLockState("elsewhere"); return; }
        const held = new Promise<void>(resolve => { release = resolve; });
        if (lockAttempt > 0) {
          inFlight.current = true; setBusy(true); setNeedsRead(true);
          // The lock lifetime follows the mounted editor, not the network read.
          void (async () => {
            try {
              const result = await reloadRef.current();
              if (cancelled) return;
              if (result.ok && result.value.blueprint.id === initial.blueprint.id) { setWorkspace(result.value); setNeedsRead(false); }
              else if (!result.ok && (result.code === "forbidden" || result.code === "unauthenticated")) setIdentityLost(true);
              else setMessage("暂时无法读取最新状态，请先重读后核对。");
            } catch { if (!cancelled) setMessage("暂时无法读取最新状态，请先重读后核对。"); }
            finally { if (!cancelled) { inFlight.current = false; setBusy(false); setLockState("owned"); } }
          })();
        } else setLockState("owned");
        await held;
      });
    }).catch(() => { if (!cancelled) { restore(); setLockState("unsupported"); } });
    return () => { cancelled = true; active.current = false; release?.(); };
  }, [storageKey, lockAttempt, initial.blueprint.id, initialVersion]);
  function persist(next: Selection) {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSelection(next); setStorageWarning(""); return true; }
    catch { setStorageWarning("无法保存本机恢复信息，原恢复内容仍保留。请恢复浏览器存储后重试。"); return false; }
  }
  const editable = lockState === "owned" && unreadable === null && !readFailed;
  const frozen = busy || Boolean(selection.attempt) || !editable;
  const nodes = workspace.blueprint.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes.map(node => ({ ...node, path: `${goal.title} / ${stage.title}` }))));
  const node = nodes.find(item => item.id === selection.nodeId);
  const current = workspace.current.find(item => item.context.nodeId === selection.nodeId);
  const evidence = workspace.evidence.ok ? workspace.evidence.value.filter(item => item.context.nodeId === selection.nodeId) : [];
  const criteriaChanged = current && node && current.completionCriteria !== (node.completionCriteria ?? "");
  const contextChanged = Boolean(selection.nodeId && (!node || selection.expectedVersion !== workspace.blueprint.version || selection.expectedStatusRevision !== (current?.revision ?? 0)));
  function selectNode(id: string) {
    const selected = nodes.find(item => item.id === id);
    persist({ ...emptySelection(workspace.blueprint.version), nodeId: id, nodeTitle: selected?.title ?? "",
      completionCriteria: selected?.completionCriteria ?? "", estimatedMinutes: selected?.estimatedMinutes ?? null,
      expectedStatusRevision: workspace.current.find(item => item.context.nodeId === id)?.revision ?? 0,
      status: workspace.current.find(item => item.context.nodeId === id)?.status ?? "not_started" });
    setMessage("");
  }
  async function save() {
    if (inFlight.current || identityLost || !editable || (!selection.attempt && (needsRead || contextChanged || !node || (selection.status === "completed" && !selection.acknowledged)))) return;
    const command = confirmNodeStatusSchema.safeParse(selection.attempt ?? { nodeId: selection.nodeId, expectedVersion: selection.expectedVersion,
      expectedStatusRevision: selection.expectedStatusRevision, status: selection.status, evidenceId: selection.evidenceId, clientMutationId: crypto.randomUUID() });
    if (!command.success) { setMessage("请重新核对节点和状态。"); return; }
    if (!persist({ ...selection, attempt: command.data })) { setMessage("本次尚未发送：无法持久化原请求。"); return; }
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const result = await saveAction(command.data);
      if (!active.current) return;
      if (result.ok) {
        const receipt = nodeStatusRecordSchema.parse(result.value);
        if (receipt.clientMutationId !== command.data.clientMutationId || receipt.context.blueprintId !== initial.blueprint.id ||
          receipt.context.nodeId !== command.data.nodeId || receipt.context.blueprintVersion !== command.data.expectedVersion ||
          receipt.revision !== command.data.expectedStatusRevision + 1 || receipt.status !== command.data.status ||
          receipt.evidenceId !== (command.data.evidenceId ?? null)) throw new Error("Unexpected receipt");
        const latest = await reloadAction();
        if (!active.current) return;
        if (latest.ok && latest.value.blueprint.id === initial.blueprint.id) {
          const remainsActive = latest.value.blueprint.goals.some(goal => goal.stages.some(stage => stage.nodes.some(item => item.id === receipt.context.nodeId)));
          if (latest.value.blueprint.version < receipt.context.blueprintVersion || (remainsActive &&
            (latest.value.current.find(item => item.context.nodeId === receipt.context.nodeId)?.revision ?? 0) < receipt.revision))
            throw new Error("Receipt not reconciled");
          setWorkspace(latest.value);
          if (persist({ ...selection, attempt: undefined, expectedStatusRevision: receipt.revision, acknowledged: false }))
            setMessage("状态确认已保存。当前状态以重新读取的云端记录为准，不代表系统认证掌握。");
        } else if (!latest.ok && (latest.code === "forbidden" || latest.code === "unauthenticated")) setIdentityLost(true);
        else setMessage("暂时无法核对当前状态，请稍后重读。");
      } else if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
      else if (result.code !== "unavailable") {
        if (persist({ ...selection, attempt: undefined })) {
          setNeedsRead(true); setMessage("原提交未被接受。选择仍保留，请读取当前路径与状态，再明确重新核对。");
        }
      } else setMessage("暂时无法确认保存结果，请保留当前选择。");
    } catch { if (active.current) setMessage("暂时无法确认保存结果，请保留当前选择。"); }
    finally { if (active.current) { setBusy(false); inFlight.current = false; } }
  }
  async function reload() {
    if (inFlight.current || identityLost || lockState === "pending") return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await reloadAction();
      if (!active.current) return;
      if (result.ok && result.value.blueprint.id === initial.blueprint.id) {
        setWorkspace(result.value); setNeedsRead(false); setMessage("已读取当前路径与状态。原选择仍保留，变化后需要明确重新核对。");
      } else if (!result.ok && (result.code === "forbidden" || result.code === "unauthenticated")) setIdentityLost(true);
      else setMessage("暂时无法读取；现有内容仍保留，这不表示记录为空。");
    } catch { if (active.current) setMessage("暂时无法读取；现有内容仍保留，这不表示记录为空。"); }
    finally { if (active.current) { setBusy(false); inFlight.current = false; } }
  }
  if (identityLost) return <Panel className="node-status-panel"><Status tone="warning">账号或登录状态已变化，原账号恢复内容仍保留。</Status><Button onClick={() => window.location.reload()}>重新验证账号</Button></Panel>;
  return <div className="node-status-workspace">
    <Panel className="node-status-panel node-status-compose">
      <div className="brand">Your assessment / 节点状态</div><h2>由你确认下一步</h2>
      <p className="subtle">状态是你的判断，不会改写路径或代替完成依据，也不代表系统认证掌握。</p>
      {storageWarning ? <Status tone="warning">{storageWarning}</Status> : null}
      {lockState === "elsewhere" ? <div><Status tone="warning">另一标签页正在编辑。本页只读；关闭原标签页后，可明确接手并重读。</Status><Button disabled={busy} onClick={() => setLockAttempt(value => value + 1)}>重新尝试编辑</Button></div> : null}
      {lockState === "unsupported" ? <Status tone="warning">浏览器无法提供安全编辑锁，本页仅可查看。请使用支持 Web Locks 的安全连接。</Status> : null}
      {lockState === "pending" ? <Status>正在核对编辑权限…</Status> : null}
      {readFailed ? <Button disabled={busy || lockState !== "owned"} onClick={() => setLockAttempt(value => value + 1)}>重新读取本机恢复信息</Button> : null}
      {unreadable !== null ? <div className="node-status-recovery"><Status tone="warning">恢复格式无法识别，原文未被覆盖。请先复制留存，再明确重置。</Status>
        <label className="field"><span>原始恢复内容</span><textarea aria-label="原始恢复内容" readOnly rows={6} value={unreadable} /></label>
        <Button disabled={busy || lockState !== "owned"} onClick={() => {
          if (lockState !== "owned" || inFlight.current) return;
          if (persist(emptySelection(workspace.blueprint.version))) setUnreadable(null);
        }}>已另行保存原文，重置恢复信息</Button></div> : null}
      <label className="field"><span>路径节点</span><select aria-label="路径节点" value={selection.nodeId} disabled={frozen} onChange={event => selectNode(event.target.value)}>
        <option value="">选择要核对的节点</option>{nodes.map(item => <option key={item.id} value={item.id}>{item.path} / {kinds[item.type]} · {item.title}</option>)}
        {selection.nodeId && !node ? <option value={selection.nodeId}>原节点已归档：{selection.nodeTitle}</option> : null}
      </select></label>
      {node ? <div className="node-status-context"><h3>{node.title}</h3><p className="subtle">{kinds[node.type]} · {node.estimatedMinutes == null ? "投入待明确" : `${node.estimatedMinutes} 分钟`}</p>
        <h4>当前完成依据</h4><p className="node-status-criteria">{node.completionCriteria || "完成依据待明确"}</p>
        <Status tone={current?.status === "completed" ? "success" : "neutral"}>当前状态：{labels[current?.status ?? "not_started"]}{current ? ` · 修订 ${current.revision}` : " · 尚无确认记录"}</Status>
        {criteriaChanged ? <Status tone="warning">完成依据已变化，旧确认不代表已按新依据完成，请重新核对。</Status> : null}
      </div> : <p className="subtle">四类路径节点均可确认，不要求视频或成果。</p>}
      {selection.attempt ? <div className="node-status-pending"><h4>待核对的原提交</h4>
        <p>{selection.nodeTitle} · 原路径版本 {selection.expectedVersion} · {labels[selection.status]}</p>
        <p>{selection.estimatedMinutes === null ? "原投入待明确" : `原预计 ${selection.estimatedMinutes} 分钟`}</p>
        <p className="node-status-criteria">原完成依据：{selection.completionCriteria || "待明确"}</p>
      </div> : null}
      {(contextChanged || needsRead) && !selection.attempt ? <div className="node-status-rebind"><Status tone="warning">原选择来自版本 {selection.expectedVersion}、状态修订 {selection.expectedStatusRevision}；当前版本 {workspace.blueprint.version}。请先重读并核对变化，不会覆盖其他确认。</Status>
        <Button disabled={frozen || needsRead || !node} onClick={() => persist({ ...selection, expectedVersion: workspace.blueprint.version,
          expectedStatusRevision: current?.revision ?? 0, nodeTitle: node?.title ?? selection.nodeTitle, completionCriteria: node?.completionCriteria ?? "",
          estimatedMinutes: node?.estimatedMinutes ?? null, evidenceId: null, acknowledged: false })}>按当前路径重新核对</Button></div> : null}
      <label className="field"><span>我的状态判断</span><select aria-label="我的状态判断" disabled={frozen || !node} value={selection.status}
        onChange={event => { persist({ ...selection, status: event.target.value as NodeStatus, evidenceId: null, acknowledged: false }); setMessage(""); }}>
        {NODE_STATUSES.map(status => <option key={status} value={status}>{labels[status]}</option>)}
      </select></label>
      {selection.status === "completed" ? <div className="node-status-assessment">
        <label className="field"><span>关联成果 · 可选</span><select aria-label="关联成果" disabled={frozen} value={selection.evidenceId ?? ""}
          onChange={event => persist({ ...selection, evidenceId: event.target.value || null, acknowledged: false })}>
          <option value="">不关联成果</option>{evidence.map(item => <option key={item.id} value={item.id}>{item.text.slice(0, 100)}</option>)}
        </select></label>
        {!workspace.evidence.ok ? <Status tone="warning">成果暂时无法读取，不代表没有成果；仍可明确作出自评。</Status> : null}
        {!selection.evidenceId ? <Status tone="warning">未关联成果：本次完成仅为自我确认，不是掌握证明。</Status> : null}
        {!node?.completionCriteria ? <Status tone="warning">尚无完成依据：请知悉这一缺口，本次仍只记录你的自评。</Status> : null}
        <label className="node-status-ack"><input type="checkbox" aria-label="我已核对完成依据，明确作出自我确认" disabled={frozen} checked={selection.acknowledged}
          onChange={event => persist({ ...selection, acknowledged: event.target.checked })} /><span>我已核对完成依据，明确作出自我确认</span></label>
      </div> : null}
      {message ? <Status>{message}</Status> : null}
      {selection.attempt ? <Status tone="warning">回执尚待核对，原请求已保留；不会自动发送，也不能修改原提交。</Status> : null}
      <Button className="primary" disabled={busy || !editable || (!selection.attempt && (contextChanged || needsRead || !node || (selection.status === "completed" && !selection.acknowledged)))} onClick={() => void save()}>{busy ? "正在核对…" : selection.attempt ? "确认原提交结果" : "确认节点状态"}</Button>
    </Panel>
    <Panel className="node-status-panel node-status-history"><div className="brand">Assessment trail / 私人历史</div><h2>每次判断都有出处</h2>
      <p className="subtle">最近 50 条确认，保留当时的名称、投入与依据；不是完整历史或能力认证。</p>
      <Button disabled={busy || lockState === "pending"} onClick={() => void reload()}>读取当前路径与状态</Button>
      {!workspace.history.length ? <p className="empty">尚无状态确认历史。默认“尚未开始”不会生成记录。</p> : <ol>{workspace.history.map(record => <li key={record.id}><article>
        <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time>
        <h3>{record.context.nodeTitle}</h3><p className="subtle">{record.context.goalTitle} / {record.context.stageTitle} · 蓝图版本 {record.context.blueprintVersion}</p>
        <strong>{labels[record.status]} · 状态修订 {record.revision}</strong>
        <p>{record.estimatedMinutes === null ? "当时投入待明确" : `当时预计 ${record.estimatedMinutes} 分钟`}</p><p className="node-status-criteria">当时完成依据：{record.completionCriteria || "待明确"}</p>
        {record.status === "completed" ? <p className="subtle">{record.evidenceId ? "已关联同节点成果；仍为自我确认。" : "未关联成果，仅为自我确认。"}</p> : null}
      </article></li>)}</ol>}
    </Panel>
  </div>;
}
