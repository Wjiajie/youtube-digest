import { expect, it } from "vitest";
import { confirmNodeStatusSchema, nodeStatusRecordSchema } from "../src/index";

const input = {
  nodeId: "a6000000-0000-4000-8000-000000000030", expectedVersion: 2,
  expectedStatusRevision: 0, status: "completed", evidenceId: null,
  clientMutationId: "a6000000-0000-4000-8000-000000000040",
};

it("allows explicit self-confirmation without evidence, but not inferred mastery or supplied criteria", () => {
  expect(confirmNodeStatusSchema.parse(input)).toEqual(input);
  expect(confirmNodeStatusSchema.safeParse({ ...input, status: "mastered" }).success).toBe(false);
  expect(confirmNodeStatusSchema.safeParse({ ...input, completionCriteria: "invented" }).success).toBe(false);
});

it("allows reopening or resetting a node, but evidence associations belong only to completion", () => {
  for (const status of ["not_started", "in_progress"]) {
    expect(confirmNodeStatusSchema.parse({ ...input, status }).status).toBe(status);
    expect(confirmNodeStatusSchema.safeParse({ ...input, status, evidenceId: "a6000000-0000-4000-8000-000000000050" }).success).toBe(false);
  }
});

it.each([
  { expectedVersion: -1 }, { expectedStatusRevision: -1 }, { expectedStatusRevision: 0.5 },
  { expectedStatusRevision: 2_147_483_647 }, { clientMutationId: "" }, { evidenceId: "foreign-text-not-an-id" },
])("rejects malformed confirmation coordinates: %j", change => {
  expect(confirmNodeStatusSchema.safeParse({ ...input, ...change }).success).toBe(false);
});

it("reads original historical completion criteria without trimming or today's form limits", () => {
  const historical = { id: input.clientMutationId, clientMutationId: input.clientMutationId,
    context: { blueprintId: "a6000000-0000-4000-8000-000000000005", blueprintVersion: 2,
      goalId: "a6000000-0000-4000-8000-000000000010", goalTitle: "演讲",
      stageId: "a6000000-0000-4000-8000-000000000020", stageTitle: "练习",
      nodeId: input.nodeId, nodeTitle: "录制", nodeType: "practice" },
    estimatedMinutes: null, completionCriteria: `\n${"🙂".repeat(3000)}\n`,
    status: "completed", revision: 1, evidenceId: null, createdAt: "2026-09-10T00:00:00.000Z" };
  expect(nodeStatusRecordSchema.parse(historical)).toEqual(historical);
});
