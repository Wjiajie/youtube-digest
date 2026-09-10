import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { createGoalClarifier } from "./goal-clarifier";
import { loadClarificationSkill } from "./clarification-skill";
import { clarificationResultSchema } from "./clarification-result";
import { parseClarificationTurn, type ClarificationTurn } from "./clarification-records";
import { createClarificationAccess, clarificationFailure, type ClarificationResponse } from "./clarification-access";
import type { ClarificationWorker, ClarificationFinish } from "./clarification-worker";

const commandSchema = z.strictObject({ turnId: z.uuid(), sessionId: z.uuid(), expectedRevision: z.int().min(1).max(2147483646),
  message: z.string().min(1).max(8000).refine(value => value.trim().length > 0) });

/** Server inference only; verified Edge owns execution writes, and user RPCs own sessions and confirmation. */
export function createCloudGoalClarifier(dependencies: {
  client: SupabaseClient; worker: ClarificationWorker; actor: Actor; model: Exclude<LanguageModel, string>;
}) {
  const actor = { ...dependencies.actor };
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  const access = createClarificationAccess(dependencies.client, actor);
  async function finish(input: ClarificationFinish): Promise<ClarificationResponse<ClarificationTurn>> {
    try {
      const { data, error } = await dependencies.worker.finish(input);
      return error ? clarificationFailure(error) : { ok: true, value: parseClarificationTurn(data, actor.userId, input.turnId) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return {
    async run(input: unknown, signal: AbortSignal): Promise<ClarificationResponse<ClarificationTurn>> {
      if (!allowed) return { ok: false, code: "forbidden" };
      const parsed = commandSchema.safeParse(input);
      if (!parsed.success || !(signal instanceof AbortSignal)) return { ok: false, code: "invalid" };
      if (signal.aborted) return { ok: false, code: "cancelled" };
      const command = parsed.data;
      try {
        const { data, error } = await dependencies.client.rpc("begin_goal_clarification", { p_turn_id: command.turnId,
          p_session_id: command.sessionId, p_expected_revision: command.expectedRevision, p_message: command.message });
        if (error) return clarificationFailure(error);
        const turn = parseClarificationTurn(data, actor.userId, command.turnId);
        if (turn.sessionId !== command.sessionId || turn.sessionRevision !== command.expectedRevision || turn.message !== command.message) return { ok: false, code: "unavailable" };
        if (turn.status !== "queued") return { ok: true, value: turn };
        if (signal.aborted) return access.cancelTurn(turn.id);
        const loaded = await loadClarificationSkill();
        if (signal.aborted) return access.cancelTurn(turn.id);
        const skill = { ...loaded.identity, instructions: loaded.instructions }, leaseId = randomUUID();
        const claimed = await dependencies.worker.claim({ turnId: turn.id, leaseId, skill });
        if (claimed.error) return clarificationFailure(claimed.error);
        const receipt = z.strictObject({ acquired: z.boolean(), turn: z.unknown() }).parse(claimed.data);
        const current = parseClarificationTurn(receipt.turn, actor.userId, turn.id);
        if (!receipt.acquired) return { ok: true, value: current };
        if (current.status !== "running" || JSON.stringify(current.skill) !== JSON.stringify(skill)) return { ok: false, code: "unavailable" };
        const result = clarificationResultSchema.parse(await createGoalClarifier({ model: dependencies.model }).run({
          turnId: current.id, brief: current.sourceBrief, workingContent: current.workingContent,
          currentQuestion: current.inputQuestion, message: current.message, history: current.history,
          signal, expectedSkillSha256: skill.sha256,
        }));
        const completion = { turnId: turn.id, leaseId, result };
        const finished = await finish(completion);
        return !finished.ok && finished.code === "unavailable" ? finish(completion) : finished;
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
