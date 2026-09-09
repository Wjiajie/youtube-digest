import type { BlueprintSnapshot, Goal, PathNode } from "./index";
import type { NodeStatusRecord } from "./node-status";

export type NodeProgressView = {
  node: PathNode;
  stageId: string;
  stageTitle: string;
  status: NodeStatusRecord | null;
  completion: "open" | "self_confirmed" | "needs_review";
  blockedBy: string[];
};
export type GoalProgressView = {
  goal: Goal;
  nodes: NodeProgressView[];
  next: NodeProgressView | null;
  confirmedCheckpoints: number;
  needsReviewCount: number;
  awaitingPlan: boolean;
  allSelfConfirmed: boolean;
};

function ordered<T extends { position: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Read-only guidance, never a command, mastery score, or automatic completion. */
export function projectBlueprintProgress(snapshot: BlueprintSnapshot, current: NodeStatusRecord[]): GoalProgressView[] {
  const latest = new Map<string, NodeStatusRecord>();
  for (const record of current) {
    if (record.context.blueprintId !== snapshot.id) continue;
    const key = `${record.context.goalId}:${record.context.nodeId}`;
    if ((latest.get(key)?.revision ?? 0) < record.revision) latest.set(key, record);
  }
  return ordered(snapshot.goals).map(source => {
    const goal = { ...source, stages: ordered(source.stages).map(stage => ({ ...stage, nodes: ordered(stage.nodes) })) };
    const nodes: NodeProgressView[] = goal.stages.flatMap(stage => stage.nodes.map(node => {
      const status = latest.get(`${goal.id}:${node.id}`) ?? null;
      const changed = status && (status.context.nodeTitle !== node.title || status.context.nodeType !== node.type
        || status.completionCriteria !== (node.completionCriteria ?? ""));
      return { node, stageId: stage.id, stageTitle: stage.title, status,
        completion: status?.status === "completed" ? changed ? "needs_review" : "self_confirmed" : "open", blockedBy: [] };
    }));
    const confirmed = new Set(nodes.filter(item => item.completion === "self_confirmed").map(item => item.node.id));
    for (const item of nodes) item.blockedBy = item.node.dependencyIds.filter(id => !confirmed.has(id));
    const eligible = nodes.filter(item => item.completion === "open" && item.blockedBy.length === 0);
    return { goal, nodes,
      next: nodes.find(item => item.completion === "needs_review")
        ?? eligible.find(item => item.status?.status === "in_progress") ?? eligible[0] ?? null,
      confirmedCheckpoints: nodes.filter(item => item.node.type === "checkpoint" && item.completion === "self_confirmed").length,
      needsReviewCount: nodes.filter(item => item.completion === "needs_review").length,
      awaitingPlan: nodes.length === 0,
      allSelfConfirmed: nodes.length > 0 && nodes.every(item => item.completion === "self_confirmed"),
    };
  });
}
