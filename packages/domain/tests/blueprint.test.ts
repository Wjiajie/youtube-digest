import { describe, expect, it } from "vitest";

import {
  diffBlueprints,
  parseBlueprintSnapshot,
  parseCurrentBlueprintSnapshot,
  prepareBlueprintDraft,
  toBlueprintMarkdown,
} from "../src/index";

const ids = {
  blueprint: "018f6f68-9b4d-7c93-a134-c8571b8f7781",
  goal: "018f6f68-9b4d-7c93-a134-c8571b8f7782",
  stage: "018f6f68-9b4d-7c93-a134-c8571b8f7783",
  learn: "018f6f68-9b4d-7c93-a134-c8571b8f7784",
  practice: "018f6f68-9b4d-7c93-a134-c8571b8f7785",
  checkpoint: "018f6f68-9b4d-7c93-a134-c8571b8f7786",
  reflection: "018f6f68-9b4d-7c93-a134-c8571b8f7787",
  resource: "018f6f68-9b4d-7c93-a134-c8571b8f7790",
} as const;

function validSnapshot() {
  return {
    schemaVersion: 1 as const,
    id: ids.blueprint,
    version: 0,
    title: "职业转型蓝图",
    goals: [
      {
        id: ids.goal,
        title: "成为数据分析师",
        position: 0,
        stages: [
          {
            id: ids.stage,
            title: "验证基础",
            position: 0,
            nodes: ["learn", "practice", "checkpoint", "reflection"].map(
              (type, position) => ({
                id: [ids.learn, ids.practice, ids.checkpoint, ids.reflection][position],
                type,
                title: `${type} node`,
                position,
                dependencyIds:
                  position === 0
                    ? []
                    : [[ids.learn, ids.practice, ids.checkpoint, ids.reflection][position - 1]],
                resources:
                  position === 0
                    ? [
                        {
                          id: ids.resource,
                          kind: "youtube_video",
                          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                          externalId: "dQw4w9WgXcQ",
                        },
                      ]
                    : [],
              }),
            ),
          },
        ],
      },
    ],
  };
}

describe("BlueprintSnapshot", () => {
  it("makes an effort-only or completion-only change reviewable and includes both in Markdown", () => {
    const before = prepareBlueprintDraft(parseBlueprintSnapshot(validSnapshot()));
    const after = structuredClone(before);
    after.goals[0]!.stages[0]!.nodes[1]!.estimatedMinutes = 90;
    after.goals[0]!.stages[0]!.nodes[1]!.completionCriteria = "提交报告\n说明三个结论";
    expect(diffBlueprints(before, after)).toEqual([{ kind: "update", entity: "path_node", id: ids.practice, label: "practice node" }]);
    expect(toBlueprintMarkdown(after)).toContain("预计投入：90 分钟");
    expect(toBlueprintMarkdown(after)).toContain("完成依据：提交报告\n    说明三个结论");
    expect(toBlueprintMarkdown(after)).toContain("预计投入：待明确");
    const criteriaOnly = structuredClone(before);
    criteriaOnly.goals[0]!.stages[0]!.nodes[1]!.completionCriteria = "提交报告";
    expect(diffBlueprints(before, criteriaOnly)).toHaveLength(1);
    const effortOnly = structuredClone(before);
    effortOnly.goals[0]!.stages[0]!.nodes[1]!.estimatedMinutes = 30;
    expect(diffBlueprints(before, effortOnly)).toHaveLength(1);
  });

  it.each([-1, 0, 1.5, 2_147_483_648, "30"])("rejects invalid estimated minutes %s", value => {
    const draft = prepareBlueprintDraft(parseBlueprintSnapshot(validSnapshot()));
    Object.assign(draft.goals[0]!.stages[0]!.nodes[0]!, { estimatedMinutes: value });
    expect(() => parseCurrentBlueprintSnapshot(draft)).toThrow();
  });

  it("keeps completion criteria bounded in UTF-16 units and distinguishes unknown from zero effort", () => {
    const draft = prepareBlueprintDraft(parseBlueprintSnapshot(validSnapshot()));
    draft.goals[0]!.stages[0]!.nodes[0]!.completionCriteria = "🧭".repeat(2001);
    expect(() => parseCurrentBlueprintSnapshot(draft)).toThrow();
    draft.goals[0]!.stages[0]!.nodes[0]!.completionCriteria = "  ";
    expect(parseCurrentBlueprintSnapshot(draft).goals[0]!.stages[0]!.nodes[0]).toMatchObject({ estimatedMinutes: null, completionCriteria: "" });
  });
  it("requires an explicit upgrade for a historical path and never drops unknown planning fields", () => {
    const historical = parseBlueprintSnapshot(validSnapshot());
    expect(() => parseCurrentBlueprintSnapshot(historical)).toThrow();
    const draft = prepareBlueprintDraft(historical);
    expect(draft.schemaVersion).toBe(2);
    expect(draft.version).toBe(historical.version);
    expect(draft.goals[0]!.stages[0]!.nodes[0]).toMatchObject({ estimatedMinutes: null, completionCriteria: "" });
    expect(historical.schemaVersion).toBe(1);
    const missing = structuredClone(draft);
    delete missing.goals[0]!.stages[0]!.nodes[0]!.estimatedMinutes;
    expect(() => parseCurrentBlueprintSnapshot(missing)).toThrow();
    const downgraded = { ...draft, schemaVersion: 1 };
    expect(() => parseBlueprintSnapshot(downgraded)).toThrow();
    const future = structuredClone(draft);
    Object.assign(future.goals[0]!.stages[0]!.nodes[0]!, { futureEvidence: "must not disappear" });
    expect(() => parseCurrentBlueprintSnapshot(future)).toThrow();
  });
  it("preserves explicit node effort and completion evidence in a version 2 path", () => {
    const input = validSnapshot();
    const snapshot = parseBlueprintSnapshot({ ...input, schemaVersion: 2, goals: input.goals.map(goal => ({
      ...goal, stages: goal.stages.map(stage => ({ ...stage, nodes: stage.nodes.map(node => ({
        ...node, estimatedMinutes: node.type === "practice" ? 90 : null,
        completionCriteria: node.type === "practice" ? "交付一份可以复现的分析报告" : "",
      })) })),
    })) });
    expect(snapshot.goals[0]!.stages[0]!.nodes[1]).toMatchObject({
      estimatedMinutes: 90, completionCriteria: "交付一份可以复现的分析报告",
    });
    expect(snapshot.goals[0]!.stages[0]!.nodes[0]).toMatchObject({ estimatedMinutes: null, completionCriteria: "" });
  });
  it("accepts one goal with ordered stages and all four path node types", () => {
    const snapshot = parseBlueprintSnapshot(validSnapshot());

    expect(snapshot.goals[0]?.stages[0]?.nodes.map((node) => node.type)).toEqual([
      "learn",
      "practice",
      "checkpoint",
      "reflection",
    ]);
  });

  it("rejects dependency cycles", () => {
    const input = validSnapshot();
    input.goals[0]!.stages[0]!.nodes[0]!.dependencyIds = [ids.reflection];

    expect(() => parseBlueprintSnapshot(input)).toThrow(/acyclic/);
  });

  it("rejects duplicate dependencies and resource IDs before persistence", () => {
    const duplicateDependency = validSnapshot();
    duplicateDependency.goals[0]!.stages[0]!.nodes[1]!.dependencyIds = [ids.learn, ids.learn];
    expect(() => parseBlueprintSnapshot(duplicateDependency)).toThrow(/unique/);

    const duplicateResource = validSnapshot();
    duplicateResource.goals[0]!.stages[0]!.nodes[0]!.resources.push(
      structuredClone(duplicateResource.goals[0]!.stages[0]!.nodes[0]!.resources[0]!),
    );
    expect(() => parseBlueprintSnapshot(duplicateResource)).toThrow(/unique/);
  });

  it("accepts only canonical eleven-character YouTube video IDs", () => {
    const input = validSnapshot();
    input.goals[0]!.stages[0]!.nodes[0]!.resources[0] = {
      id: ids.resource,
      kind: "youtube_video",
      url: "https://www.youtube.com/watch?v=short1",
      externalId: "short1",
    };

    expect(() => parseBlueprintSnapshot(input)).toThrow(/canonical/);
  });

  it("describes a user-reviewable change without replacing stable IDs", () => {
    const before = parseBlueprintSnapshot(validSnapshot());
    const draft = structuredClone(before);
    draft.goals[0]!.stages[0]!.nodes[1]!.title = "完成一次真实数据分析";
    draft.goals[0]!.stages[0]!.nodes.splice(3, 1);

    expect(diffBlueprints(before, draft)).toEqual([
      {
        kind: "update",
        entity: "path_node",
        id: ids.practice,
        label: "完成一次真实数据分析",
      },
      {
        kind: "archive",
        entity: "path_node",
        id: ids.reflection,
        label: "reflection node",
      },
    ]);
  });

  it("exports Markdown as a derived review format", () => {
    const markdown = toBlueprintMarkdown(parseBlueprintSnapshot(validSnapshot()));

    expect(markdown).toContain("# 职业转型蓝图");
    expect(markdown).toContain("## 成为数据分析师");
    expect(markdown).toContain("### 验证基础");
    expect(markdown).toContain("- [学习] learn node");
    expect(markdown).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});
