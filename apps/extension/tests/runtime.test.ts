import { describe, expect, it, vi } from "vitest";
import { prepareBlueprintDraft } from "@blueprint/domain";

import { findBoundNodes, flushOutbox, type OutboxCommand } from "../src/runtime";

const snapshot = {
  schemaVersion: 1 as const,
  id: "018f6f68-9b4d-7c93-a134-c8571b8f7801",
  version: 1,
  title: "职业蓝图",
  goals: [{
    id: "018f6f68-9b4d-7c93-a134-c8571b8f7802",
    title: "数据分析师",
    position: 0,
    stages: [{
      id: "018f6f68-9b4d-7c93-a134-c8571b8f7803",
      title: "基础",
      position: 0,
      nodes: [{
        id: "018f6f68-9b4d-7c93-a134-c8571b8f7804",
        type: "learn" as const,
        title: "SQL 基础",
        position: 0,
        dependencyIds: [],
        resources: [{
          id: "018f6f68-9b4d-7c93-a134-c8571b8f7805",
          kind: "youtube_video" as const,
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          externalId: "dQw4w9WgXcQ",
        }],
      }],
    }],
  }],
};

describe("extension runtime", () => {
  it("keeps video context usable when a current path carries explicit node planning metadata", () => {
    const current = prepareBlueprintDraft(snapshot);
    const node = current.goals[0]!.stages[0]!.nodes[0]!;
    node.estimatedMinutes = 45;
    node.completionCriteria = "独立完成三条查询";
    node.description = "学会分析数据";
    expect(findBoundNodes(current, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject([{
      nodeId: "018f6f68-9b4d-7c93-a134-c8571b8f7804", nodeTitle: "SQL 基础", videoId: "dQw4w9WgXcQ",
      description: "学会分析数据", estimatedMinutes: 45, completionCriteria: "独立完成三条查询",
    }]);
  });
  it("matches the current canonical YouTube video to its Goal context", () => {
    expect(findBoundNodes(snapshot, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject([{
      goalTitle: "数据分析师",
      stageTitle: "基础",
      nodeTitle: "SQL 基础",
      description: null, estimatedMinutes: null, completionCriteria: "",
    }]);
  });

  it("returns every binding for the video without silently choosing a path", () => {
    const current = prepareBlueprintDraft(snapshot);
    const node = current.goals[0]!.stages[0]!.nodes[0]!;
    node.resources.push({ ...node.resources[0]!, id: "018f6f68-9b4d-7c93-a134-c8571b8f7808" });
    current.goals[0]!.stages[0]!.nodes.push({ ...node, id: "018f6f68-9b4d-7c93-a134-c8571b8f7806", title: "另一条路径", position: 1,
      resources: [{ ...node.resources[0]!, id: "018f6f68-9b4d-7c93-a134-c8571b8f7807" }] });
    expect(findBoundNodes(current, "https://www.youtube.com/watch?v=dQw4w9WgXcQ").map((item) => [item.nodeTitle, item.resourceBindingId])).toEqual([
      ["SQL 基础", "018f6f68-9b4d-7c93-a134-c8571b8f7805"],
      ["SQL 基础", "018f6f68-9b4d-7c93-a134-c8571b8f7808"],
      ["另一条路径", "018f6f68-9b4d-7c93-a134-c8571b8f7807"],
    ]);
  });

  it.each(["https://www.youtube.com/watch?v=abcdefghijk", "https://evil.test/watch?v=dQw4w9WgXcQ", "http://www.youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://www.youtube.com/shorts/dQw4w9WgXcQ"])("has no context for an unbound or unsupported URL %s", (url) => {
    expect(findBoundNodes(snapshot, url)).toEqual([]);
  });

  it("retries only the signed-in user's commands and preserves failures", async () => {
    const commands: OutboxCommand[] = [
      { ownerId: "user-a", clientMutationId: "a", nodeId: "node-a", startedAt: "2026-08-26T00:00:00Z", attempts: 0 },
      { ownerId: "user-b", clientMutationId: "b", nodeId: "node-b", startedAt: "2026-08-26T00:00:00Z", attempts: 1 },
    ];
    const send = vi.fn(async () => "retryable" as const);

    const result = await flushOutbox(commands, "user-a", send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.remaining).toEqual([
      { ...commands[0], attempts: 1 },
      commands[1],
    ]);
  });

  it("returns recovered commands so offline failure events can be repaired", async () => {
    const command: OutboxCommand = {
      ownerId: "user-a",
      clientMutationId: "a",
      nodeId: "node-a",
      startedAt: "2026-08-26T00:00:00Z",
      attempts: 1,
      failureRecorded: false,
    };

    const result = await flushOutbox([command], "user-a", async () => "sent");

    expect(result).toEqual({ remaining: [], recovered: 1, recoveredCommands: [command], rejected: 0 });
  });

  it("removes permanently rejected commands instead of retrying forever", async () => {
    const command: OutboxCommand = {
      ownerId: "user-a",
      clientMutationId: "a",
      nodeId: "node-a",
      startedAt: "2026-08-26T00:00:00Z",
      attempts: 2,
    };

    const result = await flushOutbox([command], "user-a", async () => "rejected");

    expect(result).toMatchObject({ remaining: [], recovered: 0, rejected: 1 });
  });
});
