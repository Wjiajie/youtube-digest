"use client";

import { useEffect, useRef, useState } from "react";
import { goalBriefContentSchema, goalBriefReadiness, type GoalBriefContent } from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";
import { AiNarrative } from "@/components/ai-elements/ai-narrative";
import type { ClarificationWorkbenchProps, ClarificationSnapshot, ClarificationTurnView, ClarificationUiFailure } from "./clarification-view";

const labels = { outcome: "我希望实现", startingPoint: "我的起点", weeklyMinutes: "每周可投入分钟", targetDate: "期望期限", constraints: "约束", successCriteria: "成功的依据" };
type Fields = Record<keyof typeof labels, string>;
function fieldsFrom(content: GoalBriefContent): Fields {
  return { outcome: content.outcome, startingPoint: content.startingPoint, weeklyMinutes: content.weeklyMinutes?.toString() ?? "",
    targetDate: content.targetDate ?? "", constraints: content.constraints, successCriteria: content.successCriteria };
}
function contentFrom(fields: Fields) {
  return goalBriefContentSchema.safeParse({ schemaVersion: 1, ...fields, targetDate: fields.targetDate || null,
    weeklyMinutes: fields.weeklyMinutes.trim() ? Number(fields.weeklyMinutes) : null });
}
function IdentityLost() {
  return <Panel className="clarify-card"><Status tone="warning">账号或登录状态已变化，私人内容已隐藏。请重新登录后打开本页。</Status><a href="/login">重新登录</a></Panel>;
}
const turnLabels = { queued: "等待执行", running: "正在整理", ready: "建议已记录", failed: "本轮未完成", cancelled: "已取消", interrupted: "执行中断", stale: "来源已变化" };
const activeTurn = (turn: ClarificationTurnView) => turn.status === "queued" || turn.status === "running";
type PendingTurn = { id: string; message?: string };
type MutationAttempt = { kind: "edit"; command: Parameters<ClarificationWorkbenchProps["editAction"]>[0] }
  | { kind: "save"; command: Parameters<ClarificationWorkbenchProps["saveAction"]>[0] };
const failureMessages: Record<ClarificationUiFailure["code"], string> = {
  disabled: "Agent 暂未启用，本轮没有开始。原文仍保留，你可以手动整理并保存。",
  forbidden: "账号或访问权限已变化。", unauthenticated: "请重新登录。",
  invalid: "请求未被接受，请检查填写内容。", not_found: "暂未查到记录；不能据此断定正在途中的请求未执行，请继续核对或取消原轮次。",
  version_conflict: "云端版本已变化，请刷新后核对；你的文字仍保留。",
  busy: "已有一轮正在执行，请先核对并等待或取消。", quota_exhausted: "当前没有可用的澄清次数。你仍可手动整理并保存。",
  window_full: "本次对话已达到 13 轮成功记录的窗口上限。请明确保存草稿作为检查点，再从目标定义开始新对话；历史不会被截断。",
  cancelled: "本轮已停止，原文仍保留。", unavailable: "暂时无法确认云端结果。请保留原文并核对，不会自动重试模型。",
};
function recoveryUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("turn", id); else url.searchParams.delete("turn");
  window.history.replaceState(window.history.state, "", url);
}
export function ClarificationWorkbench(props: ClarificationWorkbenchProps) {
  const owner = useRef(props.accountId);
  if (owner.current !== props.accountId) return <IdentityLost />;
  return <Workbench key={`${props.accountId}:${props.initial.session.id}`} {...props} />;
}
function Workbench({ accountId, initial, enabled, pendingTurnId, readAction, readTurnAction, cancelAction, editAction, saveAction }: ClarificationWorkbenchProps) {
  const [snapshot, setSnapshot] = useState(initial);
  const [fields, setFields] = useState(() => fieldsFrom(initial.session.content));
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState<PendingTurn | null>(() => {
    const id = pendingTurnId ?? initial.turns.find(activeTurn)?.id;
    return id ? { id } : null;
  });
  const [reading, setReading] = useState(false), [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState(""), [announcement, setAnnouncement] = useState("");
  const [identityLost, setIdentityLost] = useState(false), [needsRead, setNeedsRead] = useState(false), [windowFull, setWindowFull] = useState(false);
  const [editorRevision, setEditorRevision] = useState(initial.session.revision);
  const [reviewed, setReviewed] = useState(false), [mutating, setMutating] = useState(false);
  const [mutation, setMutation] = useState<MutationAttempt | null>(null), [saved, setSaved] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false), [hasMore, setHasMore] = useState(initial.hasMore);
  const [nextOffset, setNextOffset] = useState(initial.offset + initial.turns.length);
  const alive = useRef(true), pendingRef = useRef(pending), cloudRef = useRef(initial.session);
  const fieldsRef = useRef(fields), answerRef = useRef(answer), readEpoch = useRef(0), cancelLock = useRef(false);
  const mutationRef = useRef<MutationAttempt | null>(null), mutationLock = useRef(false);
  const settledTurns = useRef(new Set(initial.turns.filter(turn => !activeTurn(turn)).map(turn => turn.id)));
  const session = snapshot.session;
  const dirty = JSON.stringify(fields) !== JSON.stringify(fieldsFrom(session.content));
  const conflict = editorRevision !== session.revision;
  function changeFields(next: Fields) { fieldsRef.current = next; setFields(next); setReviewed(false); }
  function changeAnswer(next: string) { answerRef.current = next; setAnswer(next); }
  function changePending(next: PendingTurn | null) { pendingRef.current = next; setPending(next); recoveryUrl(next?.id ?? null); }
  function failure(code: ClarificationUiFailure["code"]) {
    if (!alive.current) return;
    if (code === "forbidden" || code === "unauthenticated") {
      alive.current = false; setIdentityLost(true); changePending(null); changeAnswer(""); return;
    }
    setAnnouncement("操作未完成，请查看状态说明；原文仍保留。");
    setNotice(failureMessages[code]);
    if (code === "window_full") setWindowFull(true);
  }
  function receiveSnapshot(next: ClarificationSnapshot) {
    if (next.session.id !== initial.session.id || next.session.briefId !== initial.session.briefId || next.session.revision < cloudRef.current.revision) throw new Error("Invalid snapshot");
    const editing = JSON.stringify(fieldsRef.current) !== JSON.stringify(fieldsFrom(cloudRef.current.content));
    cloudRef.current = next.session;
    setSnapshot(previous => ({ ...next, turns: mergeTurns(previous.turns, next.turns) }));
    setNextOffset(next.offset + next.turns.length); setHasMore(next.hasMore);
    if (!editing && !mutationRef.current) { changeFields(fieldsFrom(next.session.content)); setEditorRevision(next.session.revision); }
    setNeedsRead(false);
    for (const turn of next.turns) if (!activeTurn(turn)) settledTurns.current.add(turn.id);
    const active = next.turns.find(turn => activeTurn(turn) && !settledTurns.current.has(turn.id));
    if (active && !pendingRef.current) changePending({ id: active.id });
  }
  function receiveTurn(turn: ClarificationTurnView, expectedId: string) {
    if (turn.id !== expectedId) throw new Error("Invalid turn");
    if (!activeTurn(turn)) settledTurns.current.add(turn.id);
    setSnapshot(previous => ({ ...previous, turns: mergeTurns(previous.turns, [turn]) }));
    const attempt = pendingRef.current;
    if (attempt?.id === turn.id) {
      if (attempt.message !== undefined && turn.answer === attempt.message && answerRef.current === attempt.message) changeAnswer("");
      if (!activeTurn(turn)) { setNeedsRead(true); changePending(null); }
    }
    setAnnouncement(`已核对云端记录：${turnLabels[turn.status]}。`);
  }
  async function refresh() {
    const epoch = ++readEpoch.current; setReading(true); setNotice(""); setAnnouncement("正在核对云端记录…");
    try {
      const attempt = pendingRef.current;
      if (attempt) {
        const result = await readTurnAction(attempt.id);
        if (!alive.current || epoch !== readEpoch.current) return;
        if (result.ok) receiveTurn(result.value, attempt.id); else { failure(result.code); return; }
      }
      const result = await readAction();
      if (!alive.current || epoch !== readEpoch.current) return;
      if (result.ok) { receiveSnapshot(result.value); setAnnouncement("已核对云端记录；阅读不会重新调用模型。"); }
      else { setNeedsRead(true); failure(result.code); }
    } catch { if (alive.current && epoch === readEpoch.current) { setNeedsRead(true); failure("unavailable"); } }
    finally { if (alive.current && epoch === readEpoch.current) setReading(false); }
  }
  async function cancel() {
    const attempt = pendingRef.current;
    if (!attempt || cancelLock.current || !alive.current) return;
    cancelLock.current = true; setCancelling(true); ++readEpoch.current; setReading(false);
    try {
      const result = await cancelAction(attempt.id);
      if (!alive.current) return;
      if (result.ok) {
        receiveTurn(result.value, attempt.id); setNeedsRead(true); await refresh();
        if (alive.current) setAnnouncement(`取消请求已返回：${turnLabels[result.value.status]}。摘要状态请以刷新结果为准。`);
      }
      else failure(result.code);
    } catch { failure("unavailable"); }
    finally { if (alive.current) { cancelLock.current = false; setCancelling(false); } }
  }
  async function loadOlder() {
    if (!alive.current || olderBusy) return;
    setOlderBusy(true);
    try {
      const result = await readAction(nextOffset);
      if (!alive.current) return;
      if (!result.ok) { failure(result.code); return; }
      if (result.value.session.id !== session.id || result.value.offset !== nextOffset) throw new Error("Invalid page");
      setSnapshot(previous => ({ ...previous, turns: mergeTurns(previous.turns, result.value.turns) }));
      setNextOffset(result.value.offset + result.value.turns.length); setHasMore(result.value.hasMore);
      setAnnouncement("更早记录已载入；没有调用模型。");
    } catch { failure("unavailable"); }
    finally { if (alive.current) setOlderBusy(false); }
  }
  async function send() {
    if (!alive.current || pendingRef.current || mutationRef.current || needsRead || dirty || conflict || windowFull || !enabled || session.status !== "active" || !answer.trim() || answer.length > 8000) return;
    const command = { accountId, sessionId: session.id, turnId: crypto.randomUUID(), expectedRevision: session.revision, message: answer };
    const attempt = { id: command.turnId, message: command.message };
    changePending(attempt); setNotice(""); setAnnouncement("已登记本轮请求，正在等待云端结果。");
    try {
      const response = await fetch("/api/clarification/turns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
      const result: unknown = await response.json();
      if (!alive.current || pendingRef.current !== attempt) return;
      if (!result || typeof result !== "object" || !("ok" in result)) throw new Error("Invalid response");
      if (result.ok === false && "code" in result && typeof result.code === "string" && Object.hasOwn(failureMessages, result.code)) {
        const code = result.code as ClarificationUiFailure["code"];
        failure(code);
        if (!["unavailable", "not_found"].includes(code) && alive.current) {
          changePending(null);
          if (["version_conflict", "busy"].includes(code)) setNeedsRead(true);
        }
      } else if (response.ok && result.ok === true && "turnId" in result && result.turnId === command.turnId && "status" in result && typeof result.status === "string" && Object.hasOwn(turnLabels, result.status)) {
        await refresh();
      } else throw new Error("Invalid response");
    } catch { if (alive.current && pendingRef.current === attempt) failure("unavailable"); }
  }
  function changeMutation(next: MutationAttempt | null) { mutationRef.current = next; setMutation(next); }
  async function mutate(kind: "edit" | "save", confirm = false) {
    if (!alive.current || mutationLock.current || pendingRef.current) return;
    let attempt = mutationRef.current;
    if (!attempt) {
      if (needsRead || conflict || session.status !== "active") return;
      const parsed = contentFrom(fieldsRef.current);
      if (!parsed.success) { setNotice("请检查日期、每周 1–10080 的整数分钟及字段长度。"); return; }
      if (kind === "save" && (dirty || confirm && (!reviewed || goalBriefReadiness(parsed.data).missing.length))) return;
      attempt = kind === "edit"
        ? { kind, command: { expectedRevision: editorRevision, content: parsed.data, clientMutationId: crypto.randomUUID() } }
        : { kind, command: { expectedRevision: editorRevision, confirm, clientMutationId: crypto.randomUUID() } };
      changeMutation(attempt);
    }
    mutationLock.current = true; setMutating(true); setNotice(""); setAnnouncement("正在核对原提交…");
    ++readEpoch.current; setReading(false);
    try {
      const result = attempt.kind === "edit" ? await editAction(attempt.command) : await saveAction(attempt.command);
      if (!alive.current) return;
      if (!result.ok) {
        failure(result.code);
        if (result.code !== "unavailable") {
          changeMutation(null);
          if (["version_conflict", "busy", "not_found"].includes(result.code)) setNeedsRead(true);
        }
        return;
      }
      const receipt = "session" in result.value ? result.value.session : result.value;
      if (receipt.id !== session.id || receipt.briefId !== session.briefId || receipt.revision !== attempt.command.expectedRevision + 1
        || (attempt.kind === "edit" && JSON.stringify(receipt.content) !== JSON.stringify(attempt.command.content))
        || (attempt.kind === "save" && receipt.status !== "closed")) throw new Error("Invalid receipt");
      const current = await readAction();
      if (!alive.current) return;
      if (!current.ok) { failure(current.code); return; }
      if (current.value.session.revision < receipt.revision) throw new Error("Historical current state");
      receiveSnapshot(current.value);
      setEditorRevision(receipt.revision); changeMutation(null); setReviewed(false);
      if (attempt.kind === "save") setSaved(true);
      setAnnouncement(attempt.kind === "save"
        ? "本次保存已完成。请到目标定义核对当前状态；不会自动生成路径。"
        : current.value.session.revision > receipt.revision
          ? "原摘要修改已完成，但云端又有更新。你的原文仍保留，请明确核对差异。"
          : "工作摘要已更新；目标定义尚未保存。");
    } catch { failure("unavailable"); }
    finally { if (alive.current) { mutationLock.current = false; setMutating(false); } }
  }
  useEffect(() => {
    alive.current = true;
    if (pendingTurnId) void refresh();
    return () => { alive.current = false; };
  }, []);
  const content = contentFrom(fields);
  const readiness = content.success ? goalBriefReadiness(content.data) : null;
  const readOnly = Boolean(pending) || Boolean(mutation) || session.status !== "active";
  const cannotSave = readOnly || needsRead || conflict || dirty;
  if (identityLost) return <IdentityLost />;
  return <div className="clarify-workbench">
    <header className="clarify-heading"><div><p className="clarify-eyebrow">CLARIFY / 目标澄清</p><h1>把想法，写成自己的方向。</h1>
      <p>对话帮助你整理，决定始终由你作出。这份工作摘要还不是已保存的目标定义。</p></div>
      <span className="clarify-seal" aria-hidden="true">立意</span></header>
    <div className="clarify-toolbar"><span>摘要修订 {session.revision} · 仅自己可见</span><Button disabled={reading} onClick={() => void refresh()}>刷新云端记录</Button></div>
    <Status>{announcement}</Status>
    {notice ? <Status tone="warning">{notice}</Status> : null}
    {session.status !== "active" ? <Status tone="warning">{session.status === "closed"
      ? "这次对话已结束。历史摘要不能代表当前目标定义的确认状态，请打开目标定义核对。"
      : "来源目标定义已变化，本会话只读。请返回目标定义后开始新的澄清。"}</Status> : null}
    {windowFull ? <p className="clarify-checkpoint">保存草稿后，可从<a href={`/goals/${session.briefId}/clarify`}>对话历史</a>明确开始新会话。</p> : null}
    <div className="clarify-layout">
      <Panel className="clarify-card clarify-conversation" aria-labelledby="clarify-conversation-title">
        <div className="clarify-section-heading"><span className="clarify-step">01</span><div><p className="clarify-eyebrow">对话 · 看清方向</p><h2 id="clarify-conversation-title">从一个真实想法开始</h2></div></div>
        {!enabled ? <Status tone="warning">Agent 暂未启用，不会调用模型。你仍可阅读、手动整理和明确保存目标定义。</Status> : null}
        <p className="clarify-muted">这里只展示已读取的轮次。{hasMore ? "更早记录可按需加载。" : "已载入当前可读历史。"}</p>
        {hasMore ? <Button disabled={olderBusy} onClick={() => void loadOlder()}>加载更早记录</Button> : null}
        <ol className="clarify-turns" tabIndex={snapshot.turns.length ? 0 : undefined} aria-label="已读取的对话记录">{[...snapshot.turns].sort((a, b) => a.ordinal - b.ordinal).map(turn => <li key={turn.id}>
          <div className="clarify-turn-meta">第 {turn.ordinal} 轮 · {turnLabels[turn.status]}{turn.skillVersion ? ` · 澄清规则 ${turn.skillVersion}` : ""}</div>
          <div className="clarify-past-question"><AiNarrative>{turn.question}</AiNarrative></div><blockquote>{turn.answer}</blockquote>
          {turn.suggestion ? <div className="clarify-suggestion"><AiNarrative>{turn.suggestion.reflection}</AiNarrative>
            {turn.suggestion.concerns.length ? <div className="clarify-concerns"><h3>仍需留意</h3>{turn.suggestion.concerns.map((concern, index) => <AiNarrative key={index}>{concern}</AiNarrative>)}</div> : null}
            {turn.suggestion.changes.length ? <details><summary>查看建议改动与原话依据 · {turn.suggestion.changes.length} 项</summary><dl>{turn.suggestion.changes.map((change, index) => <div key={index}>
              <dt>{labels[change.field]}</dt><dd>{change.value ?? "清除此项"}<blockquote>{change.quote}</blockquote></dd></div>)}</dl></details> : null}
          </div> : null}
        </li>)}</ol>
        <div className="clarify-current"><p className="clarify-eyebrow">{session.mode === "paused" ? "已暂停 · 不会自动继续" : session.mode === "reviewable" ? "等待你核对摘要" : "当前问题"}</p><AiNarrative>{session.question}</AiNarrative></div>
        {pending ? <div className="clarify-pending"><p>本轮结果仍待核对。刷新或离开不会自动重发；取消不保证供应商停止计费。</p>
          <a href={`/clarification/${session.id}?turn=${pending.id}`}>本轮恢复链接</a><Button disabled={cancelling} onClick={() => void cancel()}>取消本轮</Button></div> : null}
        <form onSubmit={event => { event.preventDefault(); void send(); }}>
          <label className="clarify-field"><span>你的回答</span><textarea aria-label="你的回答" rows={4} maxLength={8000} value={answer} readOnly={readOnly} onChange={event => changeAnswer(event.target.value)} /></label>
          <div className="clarify-composer-footer"><small>{answer.length} / 8000</small><Button type="submit" disabled={!enabled || !answer.trim() || readOnly || needsRead || dirty || conflict || windowFull}>发送回答</Button></div>
        </form>
      </Panel>
      <div className="clarify-definition">
        <Panel className="clarify-card" aria-labelledby="clarify-summary-title">
          <div className="clarify-section-heading"><span className="clarify-step">02</span><div><p className="clarify-eyebrow">摘要 · 用你的话</p><h2 id="clarify-summary-title">工作摘要</h2></div></div>
          <p className="clarify-muted">可直接修正建议。只有明确保存，才会改动目标定义。</p>
          {(["outcome", "startingPoint", "weeklyMinutes", "targetDate", "constraints", "successCriteria"] as const).map(field => <label className="clarify-field" key={field}>
            <span>{labels[field]}{field === "constraints" || field === "targetDate" ? <small>可选</small> : null}</span>
            {field === "weeklyMinutes" || field === "targetDate"
              ? <input aria-label={labels[field]} type={field === "targetDate" ? "date" : "number"} min={field === "weeklyMinutes" ? 1 : undefined} max={field === "weeklyMinutes" ? 10080 : undefined}
                  value={fields[field]} readOnly={readOnly} onChange={event => changeFields({ ...fields, [field]: event.target.value })} />
              : <textarea aria-label={labels[field]} rows={field === "successCriteria" ? 3 : 2} maxLength={field === "successCriteria" ? 4000 : 2000}
                  value={fields[field]} readOnly={readOnly} onChange={event => changeFields({ ...fields, [field]: event.target.value })} />}
          </label>)}
          {dirty ? <p className="clarify-unsaved">你的编辑尚未应用。请先更新工作摘要，再继续对话或保存目标定义。</p> : null}
          {conflict ? <div className="clarify-conflict"><Status tone="warning">云端摘要已有更新。这里保留你基于修订 {editorRevision} 的文字。</Status>
            <details><summary>查看当前云端摘要</summary><dl>{Object.entries(fieldsFrom(session.content)).map(([key, value]) => <div key={key}><dt>{labels[key as keyof Fields]}</dt><dd>{value || "未填写"}</dd></div>)}</dl></details>
            <Button disabled={readOnly || needsRead} onClick={() => { setEditorRevision(session.revision); setReviewed(false); }}>保留我的文字，以当前修订重新核对</Button>
            <Button disabled={readOnly || needsRead} onClick={() => { changeFields(fieldsFrom(session.content)); setEditorRevision(session.revision); }}>放弃本机修改，使用云端摘要</Button>
          </div> : null}
          {mutation ? <div className="clarify-recovery"><p>尚未确认原提交的当前结果。原文与提交编号已保留；请勿关闭页面。</p>
            <Button disabled={mutating} onClick={() => void mutate(mutation.kind)}>核对原提交结果</Button></div> : null}
          <div className="clarify-actions"><Button disabled={readOnly || needsRead || conflict || !dirty || !content.success} onClick={() => void mutate("edit")}>更新工作摘要</Button>
            <Button disabled={readOnly || !dirty} onClick={() => { changeFields(fieldsFrom(session.content)); setEditorRevision(session.revision); }}>撤销本机编辑</Button></div>
        </Panel>
        <Panel className="clarify-card clarify-readiness" aria-labelledby="clarify-readiness-title">
          <div className="clarify-section-heading"><span className="clarify-step">03</span><div><p className="clarify-eyebrow">核对 · 再决定</p><h2 id="clarify-readiness-title">方向准备度</h2></div></div>
          <p>完整度不等于目标质量，也不是实现目标的保证。</p>
          {readiness ? <><ul>{(["outcome", "startingPoint", "weeklyMinutes", "successCriteria"] as const).map(field => <li key={field}><span aria-hidden="true">{readiness.missing.includes(field) ? "○" : "✓"}</span> {labels[field]}：{readiness.missing.includes(field) ? "待补充" : "已填写"}</li>)}</ul>
            <p className="clarify-muted">可选未知项：{readiness.uncertainties.length ? readiness.uncertainties.map(field => labels[field]).join("、") : "无"}。未知不等于没有限制。</p></> : <Status tone="warning">请检查日期、时间及字段长度。</Status>}
          <label className="clarify-review"><input type="checkbox" checked={reviewed} disabled={cannotSave || !readiness || readiness.missing.length > 0}
            onChange={event => setReviewed(event.target.checked)} />我已核对摘要，确认它表达了我的目标</label>
          <div className="clarify-actions"><Button disabled={cannotSave} onClick={() => void mutate("save", false)}>保存草稿</Button>
            <Button className="primary" disabled={cannotSave || !reviewed || !readiness || readiness.missing.length > 0} onClick={() => void mutate("save", true)}>确认这版目标定义</Button></div>
          <p className="clarify-muted">保存草稿可留作检查点；确认定义不会自动生成路径。</p>
          {saved ? <p>本次保存已完成。当前状态请以目标定义页面为准。</p> : null}
          <div className="clarify-links"><a href={`/goals/${session.briefId}`}>查看目标定义 →</a><a href={`/goals/${session.briefId}/clarify`}>对话历史与新会话 →</a></div>
        </Panel>
      </div>
    </div>
  </div>;
}
function mergeTurns(previous: ClarificationTurnView[], incoming: ClarificationTurnView[]) {
  const turns = new Map(previous.map(turn => [turn.id, turn]));
  for (const turn of incoming) {
    const known = turns.get(turn.id);
    if (!known || activeTurn(known) || !activeTurn(turn)) turns.set(turn.id, turn);
  }
  return [...turns.values()];
}
