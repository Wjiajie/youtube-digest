import { describe, expect, it } from "vitest";

import {
  diffBlueprints,
  parseBlueprintSnapshot,
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
