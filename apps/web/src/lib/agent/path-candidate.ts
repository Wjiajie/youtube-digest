import { z } from "zod";
import { NODE_TYPES } from "@blueprint/domain";

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const pathCandidateSchema = z.strictObject({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(2000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8),
  stages: z.array(z.strictObject({
    title: z.string().trim().min(1).max(240),
    nodes: z.array(z.strictObject({
      key, type: z.enum(NODE_TYPES), title: z.string().trim().min(1).max(240),
      description: z.string().trim().min(1).max(2000), estimatedMinutes: z.int().min(1).max(10080),
      completionCriteria: z.string().trim().min(1).max(4000), week: z.int().min(1).max(26),
      dependsOn: z.array(key).max(64),
    })).min(1).max(32),
  })).min(1).max(12),
});
export type PathCandidate = z.infer<typeof pathCandidateSchema>;

/** Topological order is also the human review order; a dependency must not be in a later week. */
export function isFeasibleCandidate(candidate: PathCandidate, budget: { weeklyMinutes: number; startDate: string; targetDate: string | null }): boolean {
  const nodes = candidate.stages.flatMap(stage => stage.nodes);
  if (nodes.length > 128) return false;
  const priorWeeks = new Map<string, number>();
  const weeklyMinutes = new Map<number, number>();
  for (const node of nodes) {
    if (priorWeeks.has(node.key) || new Set(node.dependsOn).size !== node.dependsOn.length) return false;
    for (const dependency of node.dependsOn) {
      const week = priorWeeks.get(dependency);
      if (week === undefined || week > node.week) return false;
    }
    const minutes = (weeklyMinutes.get(node.week) ?? 0) + node.estimatedMinutes;
    if (minutes > budget.weeklyMinutes) return false;
    const weekStart = Date.parse(budget.startDate) + (node.week - 1) * 7 * 86_400_000;
    if (budget.targetDate !== null && weekStart > Date.parse(budget.targetDate)) return false;
    priorWeeks.set(node.key, node.week);
    weeklyMinutes.set(node.week, minutes);
  }
  return true;
}
