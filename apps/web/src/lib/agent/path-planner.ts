import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { blueprintSnapshotSchema, goalBriefSchema, parseCurrentBlueprintSnapshot, prepareBlueprintDraft } from "@blueprint/domain";
import { loadPlanningSkill } from "./planning-skill";
import { pathCandidateSchema, isFeasibleCandidate } from "./path-candidate";
import type { PlanningResult as Result, PlanningUsage as Usage } from "./planning-result";
import { generateStructuredSkill } from "./structured-skill-generation";

const requestSchema = z.strictObject({
  runId: z.uuid(), startDate: z.iso.date().refine(value => !value.startsWith("0000-")), signal: z.instanceof(AbortSignal),
  brief: goalBriefSchema, blueprint: blueprintSnapshotSchema,
  expectedSkillSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export function createPathPlanner(dependencies: { model: Exclude<LanguageModel, string>; newId?: () => string }) {
  const newId = dependencies.newId ?? randomUUID;
  return {
    async run(input: unknown): Promise<Result> {
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) return { status: "invalid_input", providerMayHaveRun: false, usage: null };
      if (parsed.data.brief.status !== "confirmed") return { status: "needs_confirmation", providerMayHaveRun: false, usage: null };
      const { brief, blueprint, startDate, runId, signal } = parsed.data;
      if (brief.blueprintId !== blueprint.id || blueprint.goals.length >= 12 ||
        (brief.content.targetDate !== null && brief.content.targetDate < startDate)) {
        return { status: "invalid_input", providerMayHaveRun: false, usage: null };
      }
      if (signal.aborted) return { status: "cancelled", providerMayHaveRun: false, usage: null };
      let providerMayHaveRun = false;
      let usage: Usage | null = null;
      try {
        const skill = await loadPlanningSkill();
        if (parsed.data.expectedSkillSha256 && parsed.data.expectedSkillSha256 !== skill.identity.sha256) {
          return { status: "unavailable", providerMayHaveRun, usage };
        }
        if (signal.aborted) return { status: "cancelled", providerMayHaveRun, usage };
        const result = await generateStructuredSkill({
          model: dependencies.model, instructions: skill.instructions, signal,
          maxOutputTokens: 12000, schema: pathCandidateSchema,
          prompt: JSON.stringify({ startDate, goalBrief: brief.content }),
        });
        if (result.status !== "generated") return result;
        providerMayHaveRun = result.providerMayHaveRun;
        usage = result.usage;
        const candidate = result.output;
        if (!isFeasibleCandidate(candidate, { weeklyMinutes: brief.content.weeklyMinutes!, startDate, targetDate: brief.content.targetDate })) {
          return { status: "invalid_output", providerMayHaveRun, usage };
        }
        const nodeIds = new Map(candidate.stages.flatMap(stage => stage.nodes.map(node => [node.key, newId()] as const)));
        const schedule = candidate.stages.flatMap(stage => stage.nodes.map(node => ({ nodeId: nodeIds.get(node.key)!, week: node.week })));
        const baseDraft = prepareBlueprintDraft(blueprint);
        const draft = parseCurrentBlueprintSnapshot({ ...baseDraft, goals: [...baseDraft.goals, {
          id: newId(), title: candidate.title, description: candidate.description,
          position: Math.max(-1, ...blueprint.goals.map(goal => goal.position)) + 1,
          stages: candidate.stages.map((stage, position) => ({ id: newId(), title: stage.title, position,
            nodes: stage.nodes.map((node, position) => ({
              id: nodeIds.get(node.key)!, type: node.type, title: node.title, description: node.description,
              estimatedMinutes: node.estimatedMinutes, completionCriteria: node.completionCriteria,
              position, dependencyIds: node.dependsOn.map(key => nodeIds.get(key)), resources: [],
            })),
          })),
        }] });
        return { status: "ready", providerMayHaveRun: true, usage, draft, schedule,
          assumptions: candidate.assumptions, skill: { ...skill.identity, instructions: skill.instructions },
          source: { runId, briefId: brief.id, briefRevision: brief.revision, blueprintId: blueprint.id, blueprintVersion: blueprint.version, startDate },
        };
      } catch {
        if (signal.aborted) return { status: "cancelled", providerMayHaveRun, usage };
        return { status: "unavailable", providerMayHaveRun, usage };
      }
    },
  };
}
