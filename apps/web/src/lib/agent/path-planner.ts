import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ToolLoopAgent, Output, isStepCount, NoObjectGeneratedError, NoOutputGeneratedError, wrapLanguageModel, type LanguageModel, type LanguageModelUsage } from "ai";
import { blueprintSnapshotSchema, goalBriefSchema, parseCurrentBlueprintSnapshot, prepareBlueprintDraft, type BlueprintSnapshot } from "@blueprint/domain";
import { loadPlanningSkill } from "./planning-skill";
import { pathCandidateSchema, isFeasibleCandidate } from "./path-candidate";

const requestSchema = z.strictObject({
  runId: z.uuid(), startDate: z.iso.date().refine(value => !value.startsWith("0000-")), signal: z.instanceof(AbortSignal),
  brief: goalBriefSchema, blueprint: blueprintSnapshotSchema,
});

type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
type Result = { status: "invalid_input" | "needs_confirmation" | "unavailable" | "invalid_output" | "cancelled" | "timed_out";
  providerMayHaveRun: boolean; usage: Usage | null } | {
  status: "ready"; providerMayHaveRun: true; usage: Usage; draft: BlueprintSnapshot;
  schedule: Array<{ nodeId: string; week: number }>; assumptions: string[];
  skill: { name: string; version: string; sha256: string };
  source: { runId: string; briefId: string; briefRevision: number; blueprintId: string; blueprintVersion: number; startDate: string };
};

function usageSummary(usage: LanguageModelUsage): Usage {
  return { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, totalTokens: usage.totalTokens ?? null };
}

/** A provider can ignore abort. Stop awaiting it without accepting its eventual result. */
function awaitWithAbort<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Planning stopped")); return; }
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("Planning stopped")); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(work).then(
      value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

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
      const deadline = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const skill = await loadPlanningSkill();
        if (signal.aborted) return { status: "cancelled", providerMayHaveRun, usage };
        const generationSignal = AbortSignal.any([signal, deadline.signal]);
        timer = setTimeout(() => deadline.abort(), 60_000);
        const agent = new ToolLoopAgent({
          model: wrapLanguageModel({ model: dependencies.model, middleware: {
            specificationVersion: "v4",
            // Provider warning prose is untrusted and may echo user content. No global logger mutation.
            wrapGenerate: async ({ doGenerate }) => ({ ...await doGenerate(), warnings: [] }),
          } }),
          instructions: skill.instructions, tools: {},
          telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
          stopWhen: isStepCount(1), maxRetries: 0, maxOutputTokens: 12000,
          output: Output.object({ schema: pathCandidateSchema }),
        });
        providerMayHaveRun = true;
        const result = await awaitWithAbort(() => agent.generate({
          prompt: JSON.stringify({ startDate, goalBrief: brief.content }), abortSignal: generationSignal,
        }), generationSignal);
        usage = usageSummary(result.totalUsage);
        if (signal.aborted) return { status: "cancelled", providerMayHaveRun, usage };
        if (deadline.signal.aborted) return { status: "timed_out", providerMayHaveRun, usage };
        if (result.finishReason !== "stop") return { status: "invalid_output", providerMayHaveRun, usage };
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
          assumptions: candidate.assumptions, skill: skill.identity,
          source: { runId, briefId: brief.id, briefRevision: brief.revision, blueprintId: blueprint.id, blueprintVersion: blueprint.version, startDate },
        };
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error) && error.usage) usage = usageSummary(error.usage);
        if (signal.aborted) return { status: "cancelled", providerMayHaveRun, usage };
        if (deadline.signal.aborted) return { status: "timed_out", providerMayHaveRun, usage };
        const status = NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error) ? "invalid_output" : "unavailable";
        return { status, providerMayHaveRun, usage };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
