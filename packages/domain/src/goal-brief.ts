import { z } from "zod";

// Preserve the user's text. Readiness uses trimmed text, but drafts are not rewritten.
export const goalBriefContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.string().max(2000),
  startingPoint: z.string().max(2000),
  targetDate: z.iso.date().refine(value => !value.startsWith("0000-"), "Date requires a positive year").nullable(),
  weeklyMinutes: z.int().min(1).max(10080).nullable(),
  constraints: z.string().max(2000),
  successCriteria: z.string().max(4000),
});
export type GoalBriefContent = z.infer<typeof goalBriefContentSchema>;

export function goalBriefReadiness(content: GoalBriefContent) {
  const missing: Array<"outcome" | "startingPoint" | "weeklyMinutes" | "successCriteria"> = [];
  for (const field of ["outcome", "startingPoint", "weeklyMinutes", "successCriteria"] as const) {
    if (field === "weeklyMinutes" ? content[field] === null : !content[field].trim()) missing.push(field);
  }
  const uncertainties: Array<"targetDate" | "constraints"> = [];
  if (content.targetDate === null) uncertainties.push("targetDate");
  if (!content.constraints.trim()) uncertainties.push("constraints");
  return { missing, uncertainties };
}

export const saveGoalBriefSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.int().min(0).max(2147483646),
  content: goalBriefContentSchema,
  confirm: z.boolean(),
  clientMutationId: z.uuid(),
}).superRefine((command, context) => {
  if (command.confirm && goalBriefReadiness(command.content).missing.length) {
    context.addIssue({ code: "custom", message: "Goal definition needs clarification before confirmation", path: ["content"] });
  }
});

export const goalBriefSchema = z.strictObject({
  id: z.uuid(), blueprintId: z.uuid(), revision: z.int().min(1).max(2147483647),
  status: z.enum(["draft", "confirmed"]), content: goalBriefContentSchema, updatedAt: z.iso.datetime({ offset: true }),
}).superRefine((brief, context) => {
  if (brief.status === "confirmed" && goalBriefReadiness(brief.content).missing.length) {
    context.addIssue({ code: "custom", message: "Invalid confirmed Goal definition" });
  }
});
export type GoalBrief = z.infer<typeof goalBriefSchema>;
export type SaveGoalBrief = z.infer<typeof saveGoalBriefSchema>;
