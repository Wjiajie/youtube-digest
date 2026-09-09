import { expect, it } from "vitest";
import { goalBriefContentSchema, goalBriefReadiness, goalBriefSchema, saveGoalBriefSchema } from "../src/goal-brief";

const empty = { schemaVersion: 1 as const, outcome: "", startingPoint: "", targetDate: null, weeklyMinutes: null, constraints: "", successCriteria: "" };
const content = { ...empty, outcome: "独立完成一场演讲", startingPoint: "没有正式演讲经验", weeklyMinutes: 180, successCriteria: "录制一次十分钟演讲并获取反馈" };
const command = { id: "c6000000-0000-4000-8000-000000000001", expectedRevision: 0, content,
  confirm: true, clientMutationId: "c6000000-0000-4000-8000-000000000002" };

it("keeps an incomplete definition as a draft but explains why it cannot be confirmed", () => {
  expect(goalBriefContentSchema.parse(empty)).toEqual(empty);
  expect(goalBriefReadiness(empty)).toEqual({ missing: ["outcome", "startingPoint", "weeklyMinutes", "successCriteria"], uncertainties: ["targetDate", "constraints"] });
  expect(saveGoalBriefSchema.safeParse({ ...command, content: empty, confirm: false }).success).toBe(true);
  expect(saveGoalBriefSchema.safeParse({ ...command, content: empty }).success).toBe(false);
});

it("accepts a generic ready definition while exposing skipped deadline and constraints", () => {
  expect(goalBriefReadiness(content)).toEqual({ missing: [], uncertainties: ["targetDate", "constraints"] });
  expect(saveGoalBriefSchema.parse(command).content).toEqual(content);
  expect(goalBriefReadiness({ ...content, targetDate: "2028-02-29", constraints: "只能周末学习" })).toEqual({ missing: [], uncertainties: [] });
});

it.each([
  { ...content, outcome: "\uFEFF\u2000\u00A0" }, { ...content, startingPoint: " " },
  { ...content, weeklyMinutes: null }, { ...content, weeklyMinutes: "180" },
  { ...content, weeklyMinutes: 0 }, { ...content, weeklyMinutes: 10081 }, { ...content, weeklyMinutes: 1.5 },
  { ...content, targetDate: "2026-02-30" }, { ...content, targetDate: "0000-01-01" },
  { ...content, outcome: "😀".repeat(1001) }, { ...content, successCriteria: "" },
  { ...content, ownerId: "forged" }, { ...content, schemaVersion: 2 },
])("rejects invalid or unready confirmation without inventing information: %j", invalid => {
  expect(saveGoalBriefSchema.safeParse({ ...command, content: invalid }).success).toBe(false);
});

it("rejects forged confirmed records while preserving valid text exactly", () => {
  const brief = { id: command.id, blueprintId: command.clientMutationId, revision: 1,
    status: "confirmed", content: empty, updatedAt: "2026-09-10T00:00:00Z" };
  expect(goalBriefSchema.safeParse(brief).success).toBe(false);
  expect(goalBriefContentSchema.parse({ ...content, outcome: "  保留我的措辞\n" }).outcome).toBe("  保留我的措辞\n");
});
