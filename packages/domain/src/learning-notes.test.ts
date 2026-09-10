import { expect, test } from "vitest";
import { recordLearningNoteSchema } from "./learning-notes";

const command = { nodeId: "fd510000-0000-4000-8000-000000000001", resourceBindingId: "fd510000-0000-4000-8000-000000000002",
  expectedVersion: 3, clientMutationId: "fd510000-0000-4000-8000-000000000003", text: "  在这里先看光线。\n", positionSeconds: 0 };

test("a timestamp note preserves the user's exact text and explicit zero position", () => {
  expect(recordLearningNoteSchema.parse(command)).toEqual(command);
  expect(recordLearningNoteSchema.parse({ ...command, positionSeconds: null }).positionSeconds).toBeNull();
});

test("a note accepts 8000 Unicode code points but rejects blank, non-scalar or oversized text", () => {
  expect(recordLearningNoteSchema.safeParse({ ...command, text: "🙂".repeat(8000) }).success).toBe(true);
  for (const text of ["", " \t\n\r\f\v\u00a0\u1680\u2000\u2028\u2029\u202f\u205f\u3000\ufeff", "字".repeat(8001), "🙂".repeat(8001), "note\u0000", "note\ud800", "\udfff"]) {
    expect(recordLearningNoteSchema.safeParse({ ...command, text }).success).toBe(false);
  }
});

test("resource ownership and source come from the server, not extra client fields", () => {
  for (const invalid of [{ ...command, ownerId: command.nodeId }, { ...command, videoId: "abcdefghijk" },
    { ...command, positionSeconds: -1 }, { ...command, positionSeconds: 1.5 }, { ...command, positionSeconds: 2_147_483_648 },
    { ...command, positionSeconds: undefined }, { ...command, expectedVersion: -1 }, { ...command, resourceBindingId: "video" }]) {
    expect(recordLearningNoteSchema.safeParse(invalid).success).toBe(false);
  }
});
