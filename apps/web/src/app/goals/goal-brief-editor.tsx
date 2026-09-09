"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { goalBriefContentSchema, goalBriefReadiness, goalBriefSchema, saveGoalBriefSchema,
  type ApplicationResult, type GoalBrief } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";

type Props = {
  accountId: string; id: string; initial: GoalBrief | null;
  saveAction: (input: unknown) => Promise<ApplicationResult<GoalBrief>>;
  reloadAction: () => Promise<ApplicationResult<GoalBrief>>;
};
const fieldsSchema = z.strictObject({ outcome: z.string(), startingPoint: z.string(), targetDate: z.string(),
  weeklyMinutes: z.string(), constraints: z.string(), successCriteria: z.string() });
const draftSchema = z.strictObject({ schemaVersion: z.literal(1), revision: z.int().nonnegative(), fields: fieldsSchema,
  attempt: saveGoalBriefSchema.optional() });
type Draft = z.infer<typeof draftSchema>;
function parseContent(fields: Draft["fields"]) {
  return goalBriefContentSchema.safeParse({ schemaVersion: 1, ...fields,
    targetDate: fields.targetDate || null, weeklyMinutes: fields.weeklyMinutes.trim() ? Number(fields.weeklyMinutes) : null });
}
function draftFrom(brief: GoalBrief | null): Draft {
  return { schemaVersion: 1, revision: brief?.revision ?? 0, fields: {
    outcome: brief?.content.outcome ?? "", startingPoint: brief?.content.startingPoint ?? "",
    targetDate: brief?.content.targetDate ?? "", weeklyMinutes: brief?.content.weeklyMinutes?.toString() ?? "",
    constraints: brief?.content.constraints ?? "", successCriteria: brief?.content.successCriteria ?? "",
  } };
}
const labels = { outcome: "我希望实现", startingPoint: "我的起点", weeklyMinutes: "每周可投入分钟", successCriteria: "成功的依据" };

export function GoalBriefEditor(props: Props) {
  return <Editor key={`${props.accountId}:${props.id}`} {...props} />;
}

function Editor({ accountId, id, initial, saveAction, reloadAction }: Props) {
  const [cloud, setCloud] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [identityLost, setIdentityLost] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [rawRecovery, setRawRecovery] = useState<string | null>(null);
  const [needsRead, setNeedsRead] = useState(false);
  const [lockState, setLockState] = useState<"pending" | "owned" | "elsewhere" | "unsupported">("pending");
  const [lockAttempt, setLockAttempt] = useState(0);
  const active = useRef(false), inFlight = useRef(false);
  const storageKey = `blueprint-goal-brief:${accountId}:${id}`;
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    let release: (() => void) | undefined;
    function restore() {
      setRecoveryBlocked(false); setRawRecovery(null); setStorageWarning("");
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw === null) { setDraft(draftFrom(initial)); return; }
        try {
          const restored = draftSchema.parse(JSON.parse(raw));
          if (restored.attempt && (restored.attempt.id !== id || restored.attempt.expectedRevision !== restored.revision)) throw new Error("Mismatched recovery");
          if (restored.attempt) {
            const shown = parseContent(restored.fields);
            if (!shown.success || JSON.stringify(shown.data) !== JSON.stringify(restored.attempt.content)) throw new Error("Mismatched recovery content");
          }
          setDraft(restored);
        } catch { setRecoveryBlocked(true); setRawRecovery(raw); }
      } catch { setRecoveryBlocked(true); setStorageWarning("无法读取本机恢复内容，原数据不会自动覆盖。请保留原文后重试。"); }
    }
    setLockState("pending");
    if (!navigator.locks) { restore(); setLockState("unsupported"); }
    else void Promise.resolve().then(() => {
      if (cancelled) return;
      return navigator.locks.request(storageKey, { ifAvailable: true }, async lock => {
        if (cancelled) return;
        restore();
        if (!lock) { setLockState("elsewhere"); return; }
        if (lockAttempt > 0) {
          try {
            const result = await reloadAction();
            if (cancelled) return;
            if (result.ok) {
              const latest = goalBriefSchema.parse(result.value);
              if (latest.id !== id) throw new Error("Wrong definition");
              setCloud(latest); setNeedsRead(false);
            } else if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
            else setNeedsRead(result.code !== "not_found" || Boolean(initial));
          } catch { if (!cancelled) setNeedsRead(true); }
        }
        if (cancelled) return;
        setLockState("owned");
        await new Promise<void>(resolve => { release = resolve; });
      });
    }).catch(() => { if (!cancelled) { restore(); setLockState("unsupported"); } });
    return () => { cancelled = true; active.current = false; release?.(); };
  }, [storageKey, lockAttempt]);
  function update(next: Draft) {
    if (recoveryBlocked || lockState !== "owned") return false;
    setDraft(next); setMessage("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(next)); setStorageWarning(""); return true;
    } catch {
      setStorageWarning("无法保存本机恢复内容，请勿关闭页面，并先复制文字留存。"); return false;
    }
  }
  const content = parseContent(draft.fields);
  const readiness = content.success ? goalBriefReadiness(content.data) : null;
  const dirty = JSON.stringify(draft.fields) !== JSON.stringify(draftFrom(cloud).fields);
  const confirmed = cloud?.status === "confirmed" && !dirty && cloud.revision === draft.revision && !draft.attempt && !needsRead;
  const conflict = draft.revision !== (cloud?.revision ?? 0) || needsRead;
  const readonly = busy || Boolean(draft.attempt) || recoveryBlocked || lockState !== "owned";

  async function reload() {
    if (inFlight.current || identityLost) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await reloadAction();
      if (!active.current) return;
      if (result.ok) {
        const latest = goalBriefSchema.parse(result.value);
        if (latest.id !== id || (cloud && (latest.blueprintId !== cloud.blueprintId || latest.revision < cloud.revision))) throw new Error("Invalid current definition");
        setCloud(latest); setNeedsRead(false); setMessage("已读取当前云端定义；本机文字仍保留，请核对差异。");
      } else if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
      else if (result.code === "not_found" && !cloud && draft.revision === 0) { setNeedsRead(false); setMessage("云端尚无此定义，本机文字仍保留。"); }
      else setMessage("暂时无法读取当前定义，原文仍保留。");
    } catch { if (active.current) setMessage("暂时无法读取当前定义，原文仍保留。"); }
    finally { if (active.current) { setBusy(false); inFlight.current = false; } }
  }

  async function save(confirm: boolean) {
    if (inFlight.current || identityLost || recoveryBlocked || lockState !== "owned" || (!draft.attempt && conflict)) return;
    const command = saveGoalBriefSchema.safeParse(draft.attempt ?? { id, expectedRevision: draft.revision, content: content.success ? content.data : null,
      confirm, clientMutationId: crypto.randomUUID() });
    if (!command.success) { setMessage("请检查字段：每周时间为 1–10080 的整数，目标与起点不超过 2000 字符，成功依据不超过 4000 字符。"); return; }
    const pending = { ...draft, attempt: command.data };
    if (!update(pending)) { setDraft(draft); setMessage("尚未发送：请先恢复浏览器存储，确保能找回原提交。"); return; }
    inFlight.current = true; setBusy(true);
    try {
      const result = await saveAction(command.data);
      if (!active.current) return;
      if (result.ok) {
        const receipt = goalBriefSchema.parse(result.value);
        if (receipt.id !== id || receipt.revision !== command.data.expectedRevision + 1
          || receipt.status !== (command.data.confirm ? "confirmed" : "draft")
          || JSON.stringify(receipt.content) !== JSON.stringify(command.data.content)) throw new Error("Invalid receipt");
        const current = await reloadAction();
        if (!active.current) return;
        if (current.ok) {
          const latest = goalBriefSchema.parse(current.value);
          if (latest.id !== id || latest.blueprintId !== receipt.blueprintId || latest.revision < receipt.revision) throw new Error("Invalid latest revision");
          setCloud(latest); setNeedsRead(false);
          if (!update({ ...draft, revision: receipt.revision, attempt: undefined })) setDraft(pending);
          setMessage(latest.revision > receipt.revision ? "原提交已完成，云端已有更新。你的原文仍保留，请核对后再编辑。" : "已保存到云端，仅自己可见。尚未生成路径。");
        } else if (current.code === "forbidden" || current.code === "unauthenticated") setIdentityLost(true);
        else setMessage("提交已收到，但暂时无法核对当前版本，请核对原提交结果后再编辑。");
      } else if (result.code === "forbidden" || result.code === "unauthenticated") setIdentityLost(true);
      else if (result.code !== "unavailable") {
        if (!update({ ...draft, attempt: undefined })) setDraft(pending);
        if (result.code === "version_conflict" || result.code === "not_found") { setNeedsRead(true); setMessage("云端版本已变化，请读取当前定义并核对；原文仍保留。"); }
        else setMessage("提交未被接受，请检查字段后重试。");
      }
    } catch { if (active.current) setMessage("暂时无法确认保存结果，请保留内容。"); }
    finally { if (active.current) { setBusy(false); inFlight.current = false; } }
  }

  if (identityLost) return <Panel className="brief-card"><Status tone="warning">账号或登录状态已变化，请重新验证账号后继续。</Status><Button onClick={() => window.location.reload()}>重新验证账号</Button></Panel>;
  return <div className="brief-workspace">
    <Panel className="brief-card">
      <div className="brand">01 / Define your direction</div><h2>目标定义卡</h2>
      <p className="subtle">用自己的话，描述想发生的改变。这里的确认不等于确认一条路径。</p>
      {storageWarning ? <Status tone="warning">{storageWarning}</Status> : null}
      {lockState === "elsewhere" ? <div><Status tone="warning">另一标签页正在编辑此定义，本页只读。关闭原标签页后可接手编辑。</Status>
        <Button disabled={busy} onClick={() => setLockAttempt(value => value + 1)}>接手编辑</Button></div> : null}
      {lockState === "unsupported" ? <Status tone="warning">浏览器无法提供安全编辑锁，目前只读；请使用安全连接与支持 Web Locks 的浏览器。</Status> : null}
      {rawRecovery !== null ? <div><Status tone="warning">恢复格式无法识别，原内容未被覆盖。请先复制留存。</Status>
        <textarea aria-label="原始恢复内容" readOnly value={rawRecovery} rows={5} />
        <Button disabled={busy || lockState !== "owned"} onClick={() => {
          if (lockState !== "owned") return;
          const next = draftFrom(cloud);
          try { localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next); setRawRecovery(null); setRecoveryBlocked(false); setStorageWarning(""); }
          catch { setStorageWarning("无法替换恢复内容，请保留原文后再试。"); }
        }}>已另行保存原文，重新开始</Button></div> : null}
      {recoveryBlocked ? <Button onClick={() => window.location.reload()}>重新读取本机恢复内容</Button> : null}
      <form onSubmit={event => { event.preventDefault(); void save(false); }} noValidate>
        {(["outcome", "startingPoint"] as const).map(field => <label className="field" key={field}><span>{labels[field]}</span>
          <textarea aria-label={labels[field]} rows={3} value={draft.fields[field]} readOnly={readonly}
            onChange={event => update({ ...draft, fields: { ...draft.fields, [field]: event.target.value } })} /></label>)}
        <div className="brief-time-grid">
          <label className="field"><span>每周可投入分钟</span><input aria-label="每周可投入分钟" type="number" min="1" max="10080" step="1" value={draft.fields.weeklyMinutes} readOnly={readonly}
            onChange={event => update({ ...draft, fields: { ...draft.fields, weeklyMinutes: event.target.value } })} /><small>例如 180 分钟 = 每周 3 小时</small></label>
          <label className="field"><span>期望期限 · 可选</span><input aria-label="期望期限" type="date" value={draft.fields.targetDate} readOnly={readonly}
            onChange={event => update({ ...draft, fields: { ...draft.fields, targetDate: event.target.value } })} /></label>
        </div>
        <label className="field"><span>约束 · 可选</span><textarea aria-label="约束" rows={2} value={draft.fields.constraints} readOnly={readonly}
          placeholder="例如：只能周末练习；目前没有可用的设备"
          onChange={event => update({ ...draft, fields: { ...draft.fields, constraints: event.target.value } })} /></label>
        <label className="field"><span>成功的依据</span><textarea aria-label="成功的依据" rows={3} value={draft.fields.successCriteria} readOnly={readonly}
          placeholder="我会用什么作品、实践或反馈判断自己实现了目标？"
          onChange={event => update({ ...draft, fields: { ...draft.fields, successCriteria: event.target.value } })} /></label>
        {dirty ? <Status tone="pending">修改尚未保存；不会自动修改已确认的云端定义。</Status> : null}
        {busy ? <Status tone="progress">正在核对云端定义，请稍候…</Status> : message ? <Status>{message}</Status> : null}
        {draft.attempt ? <div><Status tone="warning">尚未核对原提交的当前结果。请先重试原请求，原文暂时锁定以防重复提交。</Status>
          <Button type="button" disabled={busy || recoveryBlocked || lockState !== "owned"} onClick={() => void save(false)}>核对原提交结果</Button></div> : null}
        <div className="brief-actions"><Button type="submit" disabled={readonly || conflict}>保存草稿</Button>
          <Button type="button" className="primary" disabled={readonly || conflict || !readiness || readiness.missing.length > 0} onClick={() => void save(true)}>确认这版目标定义</Button></div>
      </form>
    </Panel>
    <aside className="brief-aside">
      <Panel className="brief-card brief-readiness"><div className="brand">02 / Readiness</div><h2>方向准备度</h2>
        <Status tone={confirmed ? "success" : "pending"}>{confirmed ? "当前云端定义已确认" : "等待你的核对"}</Status>
        <p className="subtle">云端修订 {cloud?.revision ?? 0} · {confirmed ? "定义已确认，尚未生成路径" : "定义仍可调整，尚未生成路径"}</p>
        <Button disabled={busy} onClick={() => void reload()}>读取当前云端定义</Button>
        {conflict ? <div className="brief-conflict"><Status tone="warning">云端已有更新，或仍需要读取最新修订。本机基于修订 {draft.revision}。</Status>
          {cloud ? <details><summary>查看当前云端文字</summary><dl>{Object.entries(draftFrom(cloud).fields).map(([key, value]) => <div key={key}><dt>{key in labels ? labels[key as keyof typeof labels] : key === "targetDate" ? "期限" : "约束"}</dt><dd>{value || "未填写"}</dd></div>)}</dl></details> : null}
          <Button disabled={readonly || needsRead || !cloud} onClick={() => { if (cloud) update({ ...draft, revision: cloud.revision }); }}>保留我的文字，以当前修订重新核对</Button>
          <Button disabled={readonly || needsRead || !cloud} onClick={() => { if (cloud) update(draftFrom(cloud)); }}>放弃本机修改，使用云端定义</Button>
        </div> : null}
        {readiness ? <ul className="brief-checklist">{Object.entries(labels).map(([field, label]) => <li key={field}>
          <span aria-hidden="true">{readiness.missing.includes(field as keyof typeof labels) ? "○" : "✓"}</span>{label}：{readiness.missing.includes(field as keyof typeof labels) ? "待补充" : "已填写"}</li>)}</ul>
          : <Status tone="warning">部分字段格式不正确，请检查时间、日期和文字长度。</Status>}
        {readiness?.uncertainties.includes("targetDate") ? <p className="brief-uncertainty">未指定期限：后续规划需要说明节奏假设。</p> : null}
        {readiness?.uncertainties.includes("constraints") ? <p className="brief-uncertainty">未说明约束：不代表没有限制，后续仍可补充。</p> : null}
      </Panel>
      <Panel className="brief-card brief-next"><div className="brand">03 / What comes next</div><h2>先看清方向，再走下一步</h2>
        <p>Agent 对话与路径规划正在建设中。现在可以整理并确认定义，不会自动生成路径或推荐视频。</p>
        <a href="/goals">返回我的目标定义 →</a>
      </Panel>
    </aside>
  </div>;
}
