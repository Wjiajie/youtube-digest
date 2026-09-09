"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { z } from "zod";

import {
  NODE_TYPES,
  canonicalYouTubeUrl,
  type BlueprintProposalRecord,
  type BlueprintSnapshot,
  type LearningSessionRecord,
  type NodeType,
  parseBlueprintSnapshot,
  parseCurrentBlueprintSnapshot,
  prepareBlueprintDraft,
} from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";

import { applyProposalAction, createProposalAction, rejectProposalAction } from "./actions";

const nodeLabels: Record<NodeType, string> = {
  learn: "学习",
  practice: "实践",
  checkpoint: "检查点",
  reflection: "复盘",
};

function hasDraftChanges(initial: BlueprintSnapshot, draft: BlueprintSnapshot, urls: Record<string, string>, minutes = minutesMap(draft)) {
  if (JSON.stringify(initial) !== JSON.stringify(draft)) return true;
  const originalMinutes = minutesMap(initial);
  if (Object.keys({ ...originalMinutes, ...minutes }).some(id => (minutes[id] ?? "") !== (originalMinutes[id] ?? ""))) return true;
  const originalUrls = resourceMap(initial);
  return Object.keys({ ...originalUrls, ...urls }).some((id) => (urls[id] ?? "") !== (originalUrls[id] ?? ""));
}

type EditorProps = {
  initial: BlueprintSnapshot;
  sessions: LearningSessionRecord[];
  createAction?: typeof createProposalAction;
  applyAction?: typeof applyProposalAction;
  rejectAction?: typeof rejectProposalAction;
};

export function BlueprintEditor({ initial, sessions, createAction = createProposalAction,
  applyAction = applyProposalAction, rejectAction = rejectProposalAction }: EditorProps) {
  const baseline = useMemo(() => prepareBlueprintDraft(initial), [initial]);
  const recoveryKey = `blueprint-draft:v2:${initial.id}`;
  const [draft, setDraft] = useState(baseline);
  const [minutesInputs, setMinutesInputs] = useState(() => minutesMap(baseline));
  const [resourceUrls, setResourceUrls] = useState<Record<string, string>>(() => resourceMap(initial));
  const [proposal, setProposal] = useState<BlueprintProposalRecord | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [rawRecovery, setRawRecovery] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    try {
      const currentSaved = localStorage.getItem(recoveryKey);
      const saved = currentSaved ?? localStorage.getItem(`blueprint-draft:${initial.id}`);
      if (saved !== null) {
        try {
          const recovery = JSON.parse(saved);
          if (currentSaved !== null && recovery.schemaVersion !== 2) throw new Error("Unknown recovery format");
          if (recovery.baseVersion !== initial.version) {
            if (currentSaved !== null) throw new Error("Stale recovery");
            setStorageWarning("此前版本的旧格式草稿仍保留在本机，未自动套用到当前蓝图。");
          } else {
          const restored = currentSaved !== null ? parseCurrentBlueprintSnapshot(recovery.draft) : prepareBlueprintDraft(parseBlueprintSnapshot(recovery.draft));
          if (restored.id !== initial.id || restored.version !== initial.version) throw new Error("Mismatched recovery");
          const strings = z.record(z.string(), z.string());
          const urls = strings.parse(recovery.resourceUrls ?? resourceMap(restored));
          const minutes = strings.parse(recovery.minutesInputs ?? minutesMap(restored));
          if (hasDraftChanges(baseline, restored, urls, minutes)) {
            setDraft(restored);
            setMinutesInputs(minutes);
            setResourceUrls(urls);
            setMessage("已恢复上次尚未确认的修改。");
          }
          if (currentSaved === null) setStorageWarning("旧格式草稿已复制到新版编辑器，原本机记录未删除；未知投入和完成依据需由你核对。");
          }
        } catch {
          setRawRecovery(saved); setRecoveryBlocked(true);
          setStorageWarning("恢复内容格式无法识别或基于旧版本，原文未被覆盖。请先复制留存，再明确重新开始。");
        }
      }
    } catch {
      setRecoveryBlocked(true); setStorageWarning("无法读取本机草稿，暂不编辑或发送，避免覆盖尚未读出的内容。请重新打开页面后重试。");
    }
    setHydrated(true);
  }, [initial, baseline, recoveryKey]);

  useEffect(() => {
    if (!hydrated || proposal || recoveryBlocked) return;
    try {
      if (hasDraftChanges(baseline, draft, resourceUrls, minutesInputs)) {
        localStorage.setItem(recoveryKey, JSON.stringify({ schemaVersion: 2, baseVersion: initial.version, draft, resourceUrls, minutesInputs }));
      } else {
        localStorage.removeItem(recoveryKey);
      }
    } catch {
      setStorageWarning("浏览器无法保存本机草稿，请勿关闭页面，并先复制文字留存。");
    }
  }, [baseline, draft, hydrated, initial.version, proposal, recoveryBlocked, recoveryKey, resourceUrls, minutesInputs]);

  const nodeCount = useMemo(
    () => draft.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes)).length,
    [draft],
  );

  function updateDraft(recipe: (next: BlueprintSnapshot) => void) {
    if (pending || recoveryBlocked || !hydrated) return;
    setProposal(null);
    setMessage("");
    setError("");
    setDraft((current) => {
      const next = structuredClone(current);
      recipe(next);
      return next;
    });
  }

  function addGoal() {
    updateDraft((next) => {
      next.goals.push({
        id: crypto.randomUUID(),
        title: `新目标 ${next.goals.length + 1}`,
        position: next.goals.length,
        stages: [{ id: crypto.randomUUID(), title: "第一阶段", position: 0, nodes: [] }],
      });
    });
  }

  function addStage(goalIndex: number) {
    updateDraft((next) => {
      const stages = next.goals[goalIndex]!.stages;
      stages.push({ id: crypto.randomUUID(), title: `阶段 ${stages.length + 1}`, position: stages.length, nodes: [] });
    });
  }

  function removeGoal(goalIndex: number) {
    const removedNodeIds = draft.goals[goalIndex]?.stages.flatMap((stage) => stage.nodes.map((node) => node.id)) ?? [];
    updateDraft((next) => {
      next.goals.splice(goalIndex, 1);
      normalizePositions(next.goals);
    });
    removeNodeInputDrafts(removedNodeIds);
  }

  function removeStage(goalIndex: number, stageIndex: number) {
    const removedNodeIds = draft.goals[goalIndex]?.stages[stageIndex]?.nodes.map((node) => node.id) ?? [];
    const removed = new Set(removedNodeIds);
    updateDraft((next) => {
      const goal = next.goals[goalIndex]!;
      goal.stages.splice(stageIndex, 1);
      normalizePositions(goal.stages);
      for (const stage of goal.stages) {
        for (const node of stage.nodes) {
          node.dependencyIds = node.dependencyIds.filter((dependencyId) => !removed.has(dependencyId));
        }
      }
    });
    removeNodeInputDrafts(removedNodeIds);
  }

  function addNode(goalIndex: number, stageIndex: number) {
    updateDraft((next) => {
      const nodes = next.goals[goalIndex]!.stages[stageIndex]!.nodes;
      const previous = nodes.at(-1);
      nodes.push({
        id: crypto.randomUUID(),
        type: "learn",
        title: `新路径节点 ${nodes.length + 1}`,
        position: nodes.length,
        dependencyIds: previous ? [previous.id] : [],
        resources: [],
        estimatedMinutes: null,
        completionCriteria: "",
      });
    });
  }

  function removeNode(goalIndex: number, stageIndex: number, nodeId: string) {
    updateDraft((next) => {
      const goal = next.goals[goalIndex]!;
      goal.stages[stageIndex]!.nodes = goal.stages[stageIndex]!.nodes.filter((node) => node.id !== nodeId);
      for (const stage of goal.stages) {
        for (const node of stage.nodes) {
          node.dependencyIds = node.dependencyIds.filter((dependencyId) => dependencyId !== nodeId);
        }
      }
      normalizePositions(goal.stages[stageIndex]!.nodes);
    });
    removeNodeInputDrafts([nodeId]);
  }

  function removeNodeInputDrafts(nodeIds: string[]) {
    setMinutesInputs(current => Object.fromEntries(Object.entries(current).filter(([id]) => !nodeIds.includes(id))));
    setResourceUrls((current) => {
      const next = { ...current };
      for (const nodeId of nodeIds) delete next[nodeId];
      return next;
    });
  }

  function prepareDraft(): BlueprintSnapshot | null {
    const next = structuredClone(draft);
    for (const goal of next.goals) {
      for (const stage of goal.stages) {
        for (const node of stage.nodes) {
          const minutes = (minutesInputs[node.id] ?? "").trim();
          node.estimatedMinutes = minutes ? Number(minutes) : null;
          if (node.estimatedMinutes !== null && (!Number.isInteger(node.estimatedMinutes) || node.estimatedMinutes < 1 || node.estimatedMinutes > 2_147_483_647)) {
            setError(`“${node.title}”的预计投入须为 1–2147483647 的整数分钟，留空表示尚未确定。`);
            return null;
          }
          const raw = (resourceUrls[node.id] ?? "").trim();
          // A planning-only edit must not collapse the node's other bindings.
          if (raw === (node.resources[0]?.url ?? "")) continue;
          if (!raw) {
            node.resources = [];
            continue;
          }
          const canonical = canonicalYouTubeUrl(raw);
          if (!canonical) {
            setError(`“${node.title}”仅支持规范的 YouTube watch 链接。`);
            return null;
          }
          node.resources = [{
            id: node.resources[0]?.id ?? crypto.randomUUID(),
            kind: "youtube_video",
            url: canonical.url,
            externalId: canonical.externalId,
          }];
        }
      }
    }
    try {
      return parseCurrentBlueprintSnapshot(next);
    } catch {
      setError("蓝图内容无效。请检查名称、依赖与节点字段；完成依据最多 4000 字符，未填写表示待明确。");
      return null;
    }
  }

  function reviewChanges() {
    if (pending || recoveryBlocked || !hydrated) return;
    const prepared = prepareDraft();
    if (!prepared) return;
    setError("");
    startTransition(async () => {
      const result = await createAction({
        draft: prepared,
        baseVersion: initial.version,
        clientMutationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        setError(result.code === "version_conflict" ? "蓝图已有更新。你的草稿仍保留，请刷新后重新确认。" : result.code === "invalid"
          ? "提案格式或字段无效，请重新读取当前蓝图并核对节点投入与完成依据；旧提案不会自动转换或应用。" : "无法创建提案，请稍后重试。");
        return;
      }
      setDraft(prepared);
      setMinutesInputs(minutesMap(prepared));
      setProposal(result.value);
      setMessage("修改尚未生效，请审阅差异。");
    });
  }

  function applyProposal() {
    if (!proposal) return;
    startTransition(async () => {
      const result = await applyAction({
        proposalId: proposal.id,
        expectedVersion: initial.version,
        clientMutationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        setError(result.code === "version_conflict" ? "版本冲突：正式蓝图没有被覆盖，草稿仍保留。" : result.code === "invalid"
          ? "此提案的格式或节点字段已不适用，未应用。请重新读取当前蓝图并核对新的提案；不会自动补全旧提案。" : "应用失败，请稍后重试。");
        return;
      }
      localStorage.removeItem(recoveryKey);
      window.location.reload();
    });
  }

  function rejectProposal() {
    if (!proposal) return;
    startTransition(async () => {
      const result = await rejectAction({ proposalId: proposal.id });
      if (!result.ok) {
        setError("暂时无法拒绝提案，请稍后重试。");
        return;
      }
      setProposal(null);
      setMessage("提案已拒绝，正式蓝图没有改变。");
    });
  }

  return (
    <Panel className="editor-panel" aria-label="蓝图结构化编辑器">
      {storageWarning ? <Status tone="warning">{storageWarning}</Status> : null}
      {rawRecovery !== null ? <div className="blueprint-recovery"><label className="field"><span>原始恢复内容</span><textarea aria-label="原始恢复内容" readOnly rows={5} value={rawRecovery} /></label>
        <Button onClick={() => {
          try {
            localStorage.removeItem(recoveryKey);
            setDraft(baseline); setMinutesInputs(minutesMap(baseline)); setResourceUrls(resourceMap(baseline));
            setRecoveryBlocked(false); setRawRecovery(null); setStorageWarning("原文已由你自行留存，现在从当前正式蓝图重新编辑。旧格式缓存未删除。");
          } catch { setStorageWarning("无法重新开始，请先复制原文留存。"); }
        }}>已另行保存原文，从当前蓝图重新开始</Button></div> : null}
      <fieldset className="blueprint-fields" disabled={pending || recoveryBlocked || !hydrated}>
      <div className="editor-header">
        <div>
          <div className="brand">Path Console</div>
          <h1>{draft.title}</h1>
          <p className="subtle">{draft.goals.length} 个目标 · {nodeCount} 个路径节点</p>
        </div>
        <Button onClick={addGoal}>添加目标</Button>
      </div>
      <label className="field">
        <span>蓝图名称</span>
        <input value={draft.title} onChange={(event) => updateDraft((next) => { next.title = event.target.value; })} />
      </label>
      {draft.goals.length === 0 ? <div className="empty">先添加一个目标，再用阶段和节点描述通往它的路径。</div> : null}
      {draft.goals.map((goal, goalIndex) => (
        <article className="goal-card" key={goal.id}>
          <div className="row">
            <label className="field" style={{ flex: 1 }}><span>目标</span><input value={goal.title} onChange={(event) => updateDraft((next) => { next.goals[goalIndex]!.title = event.target.value; })} /></label>
            <Button onClick={() => addStage(goalIndex)}>添加阶段</Button>
            <Button className="danger" onClick={() => removeGoal(goalIndex)}>移除目标</Button>
          </div>
          {goal.stages.map((stage, stageIndex) => (
            <section className="stage-card" key={stage.id}>
              <div className="row">
                <label className="field" style={{ flex: 1 }}><span>阶段</span><input value={stage.title} onChange={(event) => updateDraft((next) => { next.goals[goalIndex]!.stages[stageIndex]!.title = event.target.value; })} /></label>
                <Button onClick={() => addNode(goalIndex, stageIndex)}>添加节点</Button>
                <Button className="danger" onClick={() => removeStage(goalIndex, stageIndex)}>移除阶段</Button>
              </div>
              {stage.nodes.map((node, nodeIndex) => (
                <div className="node-card" key={node.id}>
                  <label className="field"><span>类型</span><select value={node.type} onChange={(event) => updateDraft((next) => { next.goals[goalIndex]!.stages[stageIndex]!.nodes[nodeIndex]!.type = event.target.value as NodeType; })}>{NODE_TYPES.map((type) => <option key={type} value={type}>{nodeLabels[type]}</option>)}</select></label>
                  <label className="field"><span>节点</span><input value={node.title} onChange={(event) => updateDraft((next) => { next.goals[goalIndex]!.stages[stageIndex]!.nodes[nodeIndex]!.title = event.target.value; })} /></label>
                  <label className="field wide node-planning-time"><span>预计投入（分钟）</span><input aria-label="预计投入（分钟）" type="number" min="1" max="2147483647" step="1" placeholder="待明确" value={minutesInputs[node.id] ?? ""} onChange={(event) => {
                    if (pending) return;
                    setProposal(null); setMessage(""); setError(""); setMinutesInputs((current) => ({ ...current, [node.id]: event.target.value }));
                  }} /><small className="subtle">留空表示投入待明确，不代表零投入。</small></label>
                  <label className="field wide"><span>完成依据</span><textarea aria-label="完成依据" rows={3} maxLength={4000} placeholder="用什么作品、实践或反馈判断这一步完成？" value={node.completionCriteria ?? ""} onChange={(event) => updateDraft((next) => { next.goals[goalIndex]!.stages[stageIndex]!.nodes[nodeIndex]!.completionCriteria = event.target.value; })} /><small className="subtle">最多 4000 字符。填写依据不会自动完成节点。</small></label>
                  <label className="field wide"><span>可选 YouTube 资源</span><input placeholder="https://www.youtube.com/watch?v=..." value={resourceUrls[node.id] ?? ""} onChange={(event) => { if (pending) return; setProposal(null); setMessage(""); setError(""); setResourceUrls((current) => ({ ...current, [node.id]: event.target.value })); }} /></label>
                  <div className="actions wide"><span className="subtle">{latestSessionLabel(sessions, node.id) ?? (node.dependencyIds.length ? "依赖前一节点" : "路径起点")}</span><Button className="danger" onClick={() => removeNode(goalIndex, stageIndex, node.id)}>移除节点</Button></div>
                </div>
              ))}
            </section>
          ))}
        </article>
      ))}
      </fieldset>
      {message ? <Status tone="success">{message}</Status> : null}
      {error ? <Status tone="danger">{error}</Status> : null}
      <div className="actions"><span className="subtle">修改会先形成提案，不会自动覆盖正式蓝图。</span><Button className="primary" disabled={pending || recoveryBlocked || !hydrated} onClick={reviewChanges}>{pending ? "处理中…" : "查看修改"}</Button></div>
      {proposal ? (
        <Panel className="proposal">
          <h2>确认路径变更</h2>
          {proposal.proposedDiff.length ? <ul>{proposal.proposedDiff.map((change) => <li key={`${change.kind}:${change.id}`}>{diffLabel(change.kind)} · {change.label}</li>)}</ul> : <p className="subtle">没有检测到结构变化。</p>}
          <NodePlanningReview before={baseline} after={proposal.proposedSnapshot} />
          <div className="actions"><Button disabled={pending} onClick={rejectProposal}>拒绝</Button><Button className="primary" disabled={pending || proposal.proposedDiff.length === 0} onClick={applyProposal}>确认并应用</Button></div>
        </Panel>
      ) : null}
    </Panel>
  );
}

function NodePlanningReview({ before, after }: { before: BlueprintSnapshot; after: BlueprintSnapshot }) {
  const nodes = (snapshot: BlueprintSnapshot) => snapshot.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes));
  const previous = new Map(nodes(before).map(node => [node.id, node]));
  const proposed = new Map(nodes(after).map(node => [node.id, node]));
  const changed = [...new Set([...previous.keys(), ...proposed.keys()])].filter(id => {
    const old = previous.get(id), next = proposed.get(id);
    return !old || !next || old.estimatedMinutes !== next.estimatedMinutes || old.completionCriteria !== next.completionCriteria;
  });
  if (!changed.length) return null;
  return <section className="node-planning-review" aria-label="节点投入与完成依据变更"><h3>节点投入与完成依据</h3>
    <p className="subtle">这是待确认的提案内容。未填写表示待明确，不会推断投入或自动完成节点。</p>
    {changed.map(id => <article key={id} className="node-planning-change"><h4>{proposed.get(id)?.title ?? previous.get(id)?.title}</h4>
      <div className="node-planning-comparison">{([previous.get(id), proposed.get(id)] as const).map((node, index) => <div key={index}>
        <strong>{index === 0 ? "变更前" : "提案值"}</strong>{node ? <dl><dt>预计投入</dt><dd>{node.estimatedMinutes == null ? "投入待明确" : `${node.estimatedMinutes} 分钟`}</dd>
          <dt>完成依据</dt><dd>{node.completionCriteria?.trim() || "依据待明确"}</dd></dl> : <p className="subtle">{index === 0 ? "尚无此节点" : "此节点将归档"}</p>}
      </div>)}</div>
    </article>)}
  </section>;
}

function normalizePositions(items: Array<{ position: number }>) {
  items.forEach((item, position) => { item.position = position; });
}

function resourceMap(snapshot: BlueprintSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes.map((node) => [node.id, node.resources[0]?.url ?? ""]))));
}

function minutesMap(snapshot: BlueprintSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes.map((node) => [node.id, node.estimatedMinutes?.toString() ?? ""]))));
}

function diffLabel(kind: BlueprintProposalRecord["proposedDiff"][number]["kind"]) {
  return { add: "新增", update: "修改", move: "移动", archive: "归档" }[kind];
}

function latestSessionLabel(sessions: LearningSessionRecord[], nodeId: string): string | null {
  const session = sessions.find((candidate) => candidate.nodeId === nodeId);
  return session ? `最近开始学习：${new Date(session.startedAt).toLocaleString("zh-CN")}` : null;
}
