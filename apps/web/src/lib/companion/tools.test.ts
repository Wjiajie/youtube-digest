import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool, type ToolContext } from "./tools";
const f = vi.hoisted(() => ({
  workspace: vi.fn(),
  briefs: vi.fn(),
  propose: vi.fn(),
  config: vi.fn(),
}));
vi.mock("../node-status", () => ({ readNodeStatusWorkspace: f.workspace }));
vi.mock("../goal-briefs", () => ({
  listGoalBriefs: f.briefs,
  readGoalBrief: vi.fn(async () => ({
    ok: true,
    value: { status: "confirmed" },
  })),
}));
vi.mock("./store", async (original) => ({
  ...(await original<typeof import("./store")>()),
  propose: f.propose,
}));
vi.mock("../agent/planning-runtime", () => ({
  planningConfiguration: f.config,
}));
const owner = "5db226e4-ae13-4c90-a437-3e726fe98ba6",
  node = "9aa581ec-51da-4380-95e1-d938d6424736";
let ctx: ToolContext;
beforeEach(() => {
  vi.clearAllMocks();
  ctx = {
    actor: { userId: owner, client: "web" },
    client: { rpc: vi.fn() } as any,
    conversationId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    schedule: vi.fn(),
    cue: vi.fn(),
  };
  f.propose.mockResolvedValue({ id: "pending", status: "pending" });
  f.config.mockReturnValue(null);
  f.workspace.mockResolvedValue({
    ok: true,
    value: {
      blueprint: {
        id: crypto.randomUUID(),
        version: 7,
        goals: [
          {
            id: crypto.randomUUID(),
            title: "目标",
            stages: [
              {
                title: "阶段",
                nodes: [
                  {
                    id: node,
                    title: "练习",
                    dependencyIds: [],
                    completionCriteria: "交付代码",
                    estimatedMinutes: 30,
                  },
                ],
              },
            ],
          },
        ],
      },
      current: [
        { context: { nodeId: node }, revision: 4, status: "in_progress" },
      ],
    },
  });
  f.briefs.mockResolvedValue({ ok: true, value: { briefs: [] } });
});
describe("companion tools propose changes and use trusted workspace versions", () => {
  it("cannot call confirmation or inherited object methods", async () => {
    for (const name of [
      "confirm",
      "apply_blueprint_proposal",
      "constructor",
      "toString",
    ])
      expect((await executeTool(ctx, name, {}, "call")).ok).toBe(false);
    expect(ctx.client.rpc).not.toHaveBeenCalled();
  });
  it("asks for missing goal fields instead of manufacturing a confirmed goal", async () => {
    const result = await executeTool(
      ctx,
      "draft_goal",
      {
        content: {
          schemaVersion: 1,
          outcome: "学习TS",
          startingPoint: "",
          weeklyMinutes: null,
          targetDate: null,
          constraints: "",
          successCriteria: "",
        },
      },
      "call",
    );
    expect(result.code).toBe("needs_clarification");
    expect(f.propose).not.toHaveBeenCalled();
  });
  it("only prepares a complete goal card", async () => {
    const content = {
      schemaVersion: 1,
      outcome: "学习TS",
      startingPoint: "会JS",
      weeklyMinutes: 120,
      targetDate: null,
      constraints: "",
      successCriteria: "完成项目",
    };
    expect(
      (await executeTool(ctx, "draft_goal", { content }, "call"))
        .requiresConfirmation,
    ).toBe(true);
    expect(f.propose).toHaveBeenCalledWith(ctx, ctx.messageId, "call", "goal", {
      content,
    });
    expect(ctx.client.rpc).not.toHaveBeenCalled();
  });
  it("binds progress to server versions and does not accept a model-supplied revision", async () => {
    const result = await executeTool(
      ctx,
      "prepare_progress",
      {
        nodeId: node,
        text: "完成练习",
        completed: true,
        expectedVersion: 999,
        expectedStatusRevision: 999,
      },
      "call",
    );
    expect(result.requiresConfirmation).toBe(true);
    expect(f.propose.mock.calls[0][4]).toMatchObject({
      expectedVersion: 7,
      expectedStatusRevision: 4,
      completed: true,
    });
    expect(ctx.client.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing nodes and unsafe artifact links before preparing a card", async () => {
    expect(
      (
        await executeTool(
          ctx,
          "prepare_progress",
          { nodeId: crypto.randomUUID(), text: "完成" },
          "call",
        )
      ).code,
    ).toBe("not_found");
    expect(
      (
        await executeTool(
          ctx,
          "prepare_progress",
          { nodeId: node, text: "完成", artifactUrl: "http://example.com" },
          "call",
        )
      ).code,
    ).toBe("invalid_arguments");
    expect(f.propose).not.toHaveBeenCalled();
  });
  it("never schedules a provider when planning is disabled", async () => {
    expect(
      (
        await executeTool(
          ctx,
          "generate_plan",
          { briefId: crypto.randomUUID() },
          "call",
        )
      ).code,
    ).toBe("planning_disabled");
    expect(ctx.schedule).not.toHaveBeenCalled();
    expect(f.propose).not.toHaveBeenCalled();
  });
  it("restricts avatar commands to the semantic capability list", async () => {
    expect(
      (
        await executeTool(
          ctx,
          "avatar_cue",
          { kind: "motion", id: "wave" },
          "call",
        )
      ).queued,
    ).toBe(true);
    expect(ctx.cue).toHaveBeenCalledWith({ kind: "motion", id: "wave" });
    expect(
      (
        await executeTool(
          ctx,
          "avatar_cue",
          { kind: "motion", id: "external-url" },
          "call",
        )
      ).ok,
    ).toBe(false);
  });
});
