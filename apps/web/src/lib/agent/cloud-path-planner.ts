import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { createPathPlanner } from "./path-planner";
import { loadPlanningSkill } from "./planning-skill";
import { parsePlanningRun, startPlanningRunSchema, type PlanningRun } from "./planning-run";
import { planningResultSchema } from "./planning-result";

type FailureCode = "forbidden" | "invalid" | "not_found" | "version_conflict" | "quota_exhausted" | "busy" | "unavailable" | "cancelled";
type RunResponse = { ok: true; run: PlanningRun } | { ok: false; code: FailureCode };

function failure(error: { code?: string; message?: string }): RunResponse {
  if (error.code === "42501") return { ok: false, code: "forbidden" };
  if (error.code === "P0002") return { ok: false, code: "not_found" };
  if (error.code === "40001") return { ok: false, code: "version_conflict" };
  if (["22023", "23514"].includes(error.code ?? "")) return { ok: false, code: "invalid" };
  if (error.code === "P0001" && error.message === "PATH_PLANNING_QUOTA_EXHAUSTED") return { ok: false, code: "quota_exhausted" };
  if (error.code === "P0001" && error.message === "PATH_PLANNING_BUSY") return { ok: false, code: "busy" };
  return { ok: false, code: "unavailable" };
}

/** Server-only orchestration. Caller resolves identity; DB checks the user client's actual JWT. */
export function createCloudPathPlanner(dependencies: {
  client: SupabaseClient; workerClient: SupabaseClient; actor: Actor; model: Exclude<LanguageModel, string>;
}) {
  const actor = { ...dependencies.actor };
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  async function call(client: SupabaseClient, name: string, args: Record<string, unknown>, runId: string): Promise<RunResponse> {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) return failure(error);
      return { ok: true, run: parsePlanningRun(data, actor.userId, runId) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  async function userCommand(name: string, runId: string): Promise<RunResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    if (!z.uuid().safeParse(runId).success) return { ok: false, code: "invalid" };
    return call(dependencies.client, name, { p_run_id: runId }, runId);
  }
  const cancel = (runId: string) => userCommand("cancel_path_planning", runId);
  return {
    read: (runId: string) => userCommand("read_path_planning", runId),
    cancel,
    async run(input: unknown, signal: AbortSignal): Promise<RunResponse> {
      if (!allowed) return { ok: false, code: "forbidden" };
      const parsed = startPlanningRunSchema.safeParse(input);
      if (!parsed.success || !(signal instanceof AbortSignal)) return { ok: false, code: "invalid" };
      if (signal.aborted) return { ok: false, code: "cancelled" };
      const command = parsed.data;
      try {
        const started = await call(dependencies.client, "begin_path_planning", {
          p_run_id: command.runId, p_brief_id: command.briefId, p_expected_brief_revision: command.expectedBriefRevision,
          p_expected_blueprint_version: command.expectedBlueprintVersion, p_start_date: command.startDate,
        }, command.runId);
        if (!started.ok) return started;
        const run = started.run;
        if (run.briefId !== command.briefId || run.briefRevision !== command.expectedBriefRevision
          || run.blueprintVersion !== command.expectedBlueprintVersion || run.startDate !== command.startDate) return { ok: false, code: "unavailable" };
        if (run.status !== "queued") return started;
        if (signal.aborted) return cancel(run.id);
        const loaded = await loadPlanningSkill();
        if (signal.aborted) return cancel(run.id);
        const skill = { ...loaded.identity, instructions: loaded.instructions };
        const leaseId = randomUUID();
        const claimed = await dependencies.workerClient.rpc("claim_path_planning", {
          p_owner_id: actor.userId, p_run_id: run.id, p_lease_id: leaseId, p_skill: skill,
        });
        if (claimed.error) return failure(claimed.error);
        const receipt = z.strictObject({ acquired: z.boolean(), run: z.unknown() }).parse(claimed.data);
        const current = parsePlanningRun(receipt.run, actor.userId, run.id);
        if (!receipt.acquired) return { ok: true, run: current };
        if (current.status !== "running" || JSON.stringify(current.skill) !== JSON.stringify(skill)) return { ok: false, code: "unavailable" };
        const result = planningResultSchema.parse(await createPathPlanner({ model: dependencies.model }).run({
          runId: current.id, startDate: current.startDate, brief: current.brief, blueprint: current.blueprint, signal,
          expectedSkillSha256: skill.sha256,
        }));
        const finishArgs = { p_owner_id: actor.userId, p_run_id: run.id, p_lease_id: leaseId, p_result: result };
        const finished = await call(dependencies.workerClient, "finish_path_planning", finishArgs, run.id);
        // Retrying this exact storage receipt is safe; never retry the model or re-acquire execution.
        return !finished.ok && finished.code === "unavailable"
          ? call(dependencies.workerClient, "finish_path_planning", finishArgs, run.id) : finished;
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
