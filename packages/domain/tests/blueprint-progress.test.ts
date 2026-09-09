import { expect, it } from "vitest";
import { projectBlueprintProgress, type BlueprintSnapshot, type NodeStatusRecord, type PathNode } from "../src/index";

const node = (id: string, position: number, dependencyIds: string[] = []): PathNode => ({
  id, position, dependencyIds, title: id, type: "practice", resources: [], estimatedMinutes: 30, completionCriteria: "交付作品",
});
const snapshot = (nodes: PathNode[]): BlueprintSnapshot => ({ schemaVersion: 2, id: "blueprint", version: 3, title: "蓝图",
  goals: [{ id: "goal", title: "演讲", position: 0, stages: [{ id: "stage", title: "准备", position: 0, nodes }] }] });
function status(id: string, change: Partial<NodeStatusRecord> = {}): NodeStatusRecord {
  return { id: `record-${id}`, clientMutationId: "mutation", context: { blueprintId: "blueprint", blueprintVersion: 2,
    goalId: "goal", goalTitle: "演讲", stageId: "stage", stageTitle: "准备", nodeId: id, nodeTitle: id, nodeType: "practice" },
  estimatedMinutes: 30, completionCriteria: "交付作品", status: "completed", revision: 1, evidenceId: null, createdAt: "2026-09-10T00:00:00Z", ...change };
}

it("selects eligible next steps in deterministic path order without mutating input", () => {
  const input = snapshot([node("b", 0, ["a"]), node("a", 0), node("c", 2)]);
  const before = structuredClone(input);
  const view = projectBlueprintProgress(input, [])[0];
  expect(view.nodes.map(item => item.node.id)).toEqual(["a", "b", "c"]);
  expect(view.next?.node.id).toBe("a");
  expect(view.nodes[1].blockedBy).toEqual(["a"]);
  expect(input).toEqual(before);
});

it("prioritizes eligible in-progress nodes but never bypasses their unmet dependencies", () => {
  const input = snapshot([node("a", 0), node("b", 1, ["a"]), node("c", 2)]);
  expect(projectBlueprintProgress(input, [status("b", { status: "in_progress" }), status("c", { status: "in_progress" })])[0].next?.node.id).toBe("c");
  expect(projectBlueprintProgress(input, [status("a"), status("b", { status: "in_progress" })])[0].next?.node.id).toBe("b");
});

it.each(["completionCriteria", "title", "type"] as const)("requires review when completed node %s changes", field => {
  const a = node("a", 0);
  if (field === "type") a.type = "checkpoint";
  else a[field] = "新标准或名称";
  const view = projectBlueprintProgress(snapshot([a, node("b", 1, ["a"])]), [status("a")])[0];
  expect(view.nodes[0].completion).toBe("needs_review");
  expect(view.next?.node.id).toBe("a");
  expect(view.needsReviewCount).toBe(1);
  expect(view.nodes[1].blockedBy).toEqual(["a"]);
  expect(view.confirmedCheckpoints).toBe(0);
});

it("does not invalidate completion merely for effort changes, and counts only checkpoints", () => {
  const a = { ...node("a", 0), estimatedMinutes: 60 };
  const b = { ...node("b", 1), type: "checkpoint" as const };
  const checkpoint = status("b"); checkpoint.context.nodeType = "checkpoint";
  const view = projectBlueprintProgress(snapshot([a, b]), [status("a"), checkpoint])[0];
  expect(view.allSelfConfirmed).toBe(true);
  expect(view.confirmedCheckpoints).toBe(1);
  expect(view.next).toBeNull();
});

it("uses latest revisions and ignores records from other blueprints/goals or removed nodes", () => {
  const foreign = status("b"); foreign.context.goalId = "other";
  const otherBlueprint = status("b"); otherBlueprint.context.blueprintId = "other";
  const view = projectBlueprintProgress(snapshot([node("a", 0), node("b", 1)]), [
    status("a", { status: "not_started", revision: 2 }), status("a"), foreign, otherBlueprint, status("removed"),
  ])[0];
  expect(view.nodes.map(item => item.completion)).toEqual(["open", "open"]);
  expect(view.nodes[1].status).toBeNull();
});

it("empty goals await planning instead of claiming completion; goals and stages also sort", () => {
  const input = snapshot([]);
  input.goals.push({ id: "earlier", title: "职业", position: 0, stages: [] });
  input.goals[0].stages.push({ id: "aaa", title: "先行", position: 0, nodes: [node("c", 0)] });
  const views = projectBlueprintProgress(input, []);
  expect(views.map(item => item.goal.id)).toEqual(["earlier", "goal"]);
  expect(views[0]).toMatchObject({ awaitingPlan: true, allSelfConfirmed: false, next: null });
  expect(views[1].goal.stages.map(stage => stage.id)).toEqual(["aaa", "stage"]);
});
