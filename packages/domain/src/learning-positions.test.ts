import { expect, test } from "vitest";
import { learningPositionSchema, recordLearningPositionSchema } from "./learning-positions";

const command = { nodeId: "fd570000-0000-4000-8000-000000000002", resourceBindingId: "fd570000-0000-4000-8000-000000000003",
  clientMutationId: "fd570000-0000-4000-8000-000000000004", expectedVersion: 2, expectedPositionVersion: 0, positionSeconds: 0 };
test("an explicit position command preserves zero and canonicalizes identity without claiming watch progress", () => {
  expect(recordLearningPositionSchema.parse({ ...command, nodeId: command.nodeId.toUpperCase() })).toEqual(command);
  for (const change of [{ positionSeconds: null }, { positionSeconds: -1 }, { positionSeconds: 1.5 }, { expectedPositionVersion: -1 },
    { expectedPositionVersion: 2147483647 }, { expectedVersion: 2147483648 }, { ownerId: command.nodeId }, { watchedSeconds: 50 }]) {
    expect(recordLearningPositionSchema.safeParse({ ...command, ...change }).success).toBe(false);
  }
});

test("a resume receipt rejects ambiguous noncanonical video URLs and incoherent position versions", () => {
  const record = { id: command.clientMutationId, clientMutationId: command.clientMutationId,
    context: { blueprintId: command.nodeId, blueprintVersion: 2, goalId: command.nodeId, goalTitle: "摄影", stageId: command.nodeId, stageTitle: "曝光",
      nodeId: command.nodeId, nodeTitle: "理解光线", nodeType: "learn" },
    resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" },
    positionSeconds: 0, expectedPositionVersion: 0, positionVersion: 1, createdAt: "2026-09-11T00:00:00Z" };
  expect(learningPositionSchema.safeParse(record).success).toBe(true);
  expect(learningPositionSchema.safeParse({ ...record, positionVersion: 2 }).success).toBe(false);
  expect(learningPositionSchema.safeParse({ ...record, resource: { ...record.resource, url: `${record.resource.url}&v=lmnopqrstuv` } }).success).toBe(false);
});
