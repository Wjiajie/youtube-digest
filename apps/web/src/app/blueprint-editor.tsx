"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  NODE_TYPES,
  canonicalYouTubeUrl,
  type BlueprintProposalRecord,
  type BlueprintSnapshot,
  type LearningSessionRecord,
  type NodeType,
  parseBlueprintSnapshot,
} from "@blueprint/domain";
import { Button, Panel, Status } from "@blueprint/ui";

import { applyProposalAction, createProposalAction, rejectProposalAction } from "./actions";

const nodeLabels: Record<NodeType, string> = {
  learn: "学习",
  practice: "实践",
  checkpoint: "检查点",
  reflection: "复盘",
};

function hasDraftChanges(initial: BlueprintSnapshot, draft: BlueprintSnapshot, urls: Record<string, string>) {
  if (JSON.stringify(initial) !== JSON.stringify(draft)) return true;
  const originalUrls = resourceMap(initial);
  return Object.keys({ ...originalUrls, ...urls }).some((id) => (urls[id] ?? "") !== (originalUrls[id] ?? ""));
}

export function BlueprintEditor({ initial, sessions }: { initial: BlueprintSnapshot; sessions: LearningSessionRecord[] }) {
  const recoveryKey = `blueprint-draft:${initial.id}`;
  const [draft, setDraft] = useState(initial);
  const [resourceUrls, setResourceUrls] = useState<Record<string, string>>(() => resourceMap(initial));
  const [proposal, setProposal] = useState<BlueprintProposalRecord | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const saved = localStorage.getItem(recoveryKey);
    if (saved) {
      try {
        const recovery = JSON.parse(saved);
        if (recovery.baseVersion === initial.version) {
          const restored = parseBlueprintSnapshot(recovery.draft);
          const urls = recovery.resourceUrls ?? resourceMap(restored);
          if (hasDraftChanges(initial, restored, urls)) {
            setDraft(restored);
            setResourceUrls(urls);
            setMessage("已恢复上次尚未确认的修改。");
          }
        }
      } catch {
        localStorage.removeItem(recoveryKey);
      }
    }
    setHydrated(true);
  }, [initial, recoveryKey]);

  useEffect(() => {
    if (!hydrated || proposal) return;
    if (hasDraftChanges(initial, draft, resourceUrls)) {
      localStorage.setItem(recoveryKey, JSON.stringify({ baseVersion: initial.version, draft, resourceUrls }));
    } else {
      localStorage.removeItem(recoveryKey);
    }
  }, [draft, hydrated, initial.version, proposal, recoveryKey, resourceUrls]);

  const nodeCount = useMemo(
    () => draft.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes)).length,
    [draft],
  );

  function updateDraft(recipe: (next: BlueprintSnapshot) => void) {
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
    removeResourceDrafts(removedNodeIds);
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
    removeResourceDrafts(removedNodeIds);
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
    removeResourceDrafts([nodeId]);
  }

  function removeResourceDrafts(nodeIds: string[]) {
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
          const raw = (resourceUrls[node.id] ?? "").trim();
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
      return parseBlueprintSnapshot(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "蓝图内容无效。");
      return null;
    }
  }

  function reviewChanges() {
    const prepared = prepareDraft();
    if (!prepared) return;
    setError("");
    startTransition(async () => {
      const result = await createProposalAction({
        draft: prepared,
        baseVersion: initial.version,
        clientMutationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        setError(result.code === "version_conflict" ? "蓝图已有更新。你的草稿仍保留，请刷新后重新确认。" : "无法创建提案，请稍后重试。");
        return;
      }
      setDraft(prepared);
      setProposal(result.value);
      setMessage("修改尚未生效，请审阅差异。");
    });
  }

  function applyProposal() {
    if (!proposal) return;
    startTransition(async () => {
      const result = await applyProposalAction({
        proposalId: proposal.id,
        expectedVersion: initial.version,
        clientMutationId: crypto.randomUUID(),
      });
      if (!result.ok) {
        setError(result.code === "version_conflict" ? "版本冲突：正式蓝图没有被覆盖，草稿仍保留。" : "应用失败，请稍后重试。");
        return;
      }
      localStorage.removeItem(recoveryKey);
      window.location.reload();
    });
  }

  function rejectProposal() {
    if (!proposal) return;
    startTransition(async () => {
      const result = await rejectProposalAction({ proposalId: proposal.id });
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
                  <label className="field wide"><span>可选 YouTube 资源</span><input placeholder="https://www.youtube.com/watch?v=..." value={resourceUrls[node.id] ?? ""} onChange={(event) => { setProposal(null); setMessage(""); setError(""); setResourceUrls((current) => ({ ...current, [node.id]: event.target.value })); }} /></label>
                  <div className="actions wide"><span className="subtle">{latestSessionLabel(sessions, node.id) ?? (node.dependencyIds.length ? "依赖前一节点" : "路径起点")}</span><Button className="danger" onClick={() => removeNode(goalIndex, stageIndex, node.id)}>移除节点</Button></div>
                </div>
              ))}
            </section>
          ))}
        </article>
      ))}
      {message ? <Status tone="success">{message}</Status> : null}
      {error ? <Status tone="danger">{error}</Status> : null}
      <div className="actions"><span className="subtle">修改会先形成提案，不会自动覆盖正式蓝图。</span><Button className="primary" disabled={pending} onClick={reviewChanges}>{pending ? "处理中…" : "查看修改"}</Button></div>
      {proposal ? (
        <Panel className="proposal">
          <h2>确认路径变更</h2>
          {proposal.proposedDiff.length ? <ul>{proposal.proposedDiff.map((change) => <li key={`${change.kind}:${change.id}`}>{diffLabel(change.kind)} · {change.label}</li>)}</ul> : <p className="subtle">没有检测到结构变化。</p>}
          <div className="actions"><Button disabled={pending} onClick={rejectProposal}>拒绝</Button><Button className="primary" disabled={pending || proposal.proposedDiff.length === 0} onClick={applyProposal}>确认并应用</Button></div>
        </Panel>
      ) : null}
    </Panel>
  );
}

function normalizePositions(items: Array<{ position: number }>) {
  items.forEach((item, position) => { item.position = position; });
}

function resourceMap(snapshot: BlueprintSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes.map((node) => [node.id, node.resources[0]?.url ?? ""]))));
}

function diffLabel(kind: BlueprintProposalRecord["proposedDiff"][number]["kind"]) {
  return { add: "新增", update: "修改", move: "移动", archive: "归档" }[kind];
}

function latestSessionLabel(sessions: LearningSessionRecord[], nodeId: string): string | null {
  const session = sessions.find((candidate) => candidate.nodeId === nodeId);
  return session ? `最近开始学习：${new Date(session.startedAt).toLocaleString("zh-CN")}` : null;
}
