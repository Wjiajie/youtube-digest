import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import { z } from "zod";
import { createClarificationAccess } from "./clarification-access";
import type { ClarificationSession, ClarificationTurn } from "./clarification-records";
import { saveGoalBrief } from "../goal-briefs";
import type { ClarificationSessionView, ClarificationTurnView, ClarificationSnapshot, ClarificationUiResult } from "../../app/clarification/clarification-view";

function sessionView(session: ClarificationSession): ClarificationSessionView {
  return { id: session.id, briefId: session.briefId, sourceRevision: session.briefRevision, revision: session.revision,
    updatedAt: session.updatedAt, status: session.status, mode: session.mode, question: session.question, content: session.content };
}
function turnView(turn: ClarificationTurn): ClarificationTurnView {
  const result = turn.result;
  return { id: turn.id, ordinal: turn.ordinal, createdAt: turn.createdAt, status: turn.status,
    question: turn.inputQuestion, answer: turn.message, skillVersion: turn.skill?.version ?? null,
    suggestion: result && "content" in result ? { mode: result.status, reflection: result.reflection,
      concerns: result.concerns, changes: result.changes } : null };
}
const startSchema = z.strictObject({ sessionId: z.uuid(), briefId: z.uuid(), expectedBriefRevision: z.int().min(0).max(2147483646) });

/** Server workspace: explicit creation and minimal client projections, never inference. */
export function createClarificationWorkspace(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity }, access = createClarificationAccess(client, actor);
  return {
    async readTurn(turnId: string, sessionId: string): Promise<ClarificationUiResult<ClarificationTurnView>> {
      const result = await access.readTurn(turnId);
      if (result.ok && result.value.sessionId !== sessionId) return { ok: false, code: "not_found" };
      return result.ok ? { ok: true, value: turnView(result.value) } : result;
    },
    async cancelTurn(turnId: string, sessionId: string): Promise<ClarificationUiResult<ClarificationTurnView>> {
      const existing = await access.readTurn(turnId);
      if (!existing.ok) return existing;
      if (existing.value.sessionId !== sessionId) return { ok: false, code: "not_found" };
      const result = await access.cancelTurn(turnId);
      return result.ok ? { ok: true, value: turnView(result.value) } : result;
    },
    async edit(input: unknown): Promise<ClarificationUiResult<ClarificationSessionView>> {
      const result = await access.edit(input);
      return result.ok ? { ok: true, value: sessionView(result.value) } : result;
    },
    async save(input: unknown): Promise<ClarificationUiResult<{ session: ClarificationSessionView; briefId: string; confirmed: boolean }>> {
      const result = await access.save(input);
      return result.ok ? { ok: true, value: { session: sessionView(result.value.session), briefId: result.value.brief.id,
        confirmed: result.value.brief.status === "confirmed" } } : result;
    },
    async start(input: unknown): Promise<ClarificationUiResult<ClarificationSessionView>> {
      if (actor.client !== "web") return { ok: false, code: "forbidden" };
      const parsed = startSchema.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const command = parsed.data;
      try {
        if (command.expectedBriefRevision === 0) {
          const saved = await saveGoalBrief(client, actor, { id: command.briefId, expectedRevision: 0, confirm: false,
            clientMutationId: command.sessionId, content: { schemaVersion: 1, outcome: "", startingPoint: "", weeklyMinutes: null,
              targetDate: null, constraints: "", successCriteria: "" } });
          if (!saved.ok) return saved;
        }
        const created = await access.create({ ...command, expectedBriefRevision: Math.max(1, command.expectedBriefRevision) });
        return created.ok ? { ok: true, value: sessionView(created.value) } : created;
      } catch { return { ok: false, code: "unavailable" }; }
    },
    async read(sessionId: string, offset = 0): Promise<ClarificationUiResult<ClarificationSnapshot>> {
      const initial = await access.read(sessionId);
      if (!initial.ok) return initial;
      const listed = await access.listTurns(sessionId, offset);
      if (!listed.ok) return listed;
      const records = await Promise.all(listed.value.items.map(item => access.readTurn(item.id)));
      const turns: ClarificationTurnView[] = [];
      for (const record of records) {
        if (!record.ok) return record;
        turns.push(turnView(record.value));
      }
      // Turn reads may reconcile a deadline or observe a completion; don't return
      // a pre-completion summary alongside a newly completed conversation turn.
      const current = await access.read(sessionId);
      if (!current.ok) return current;
      return { ok: true, value: { session: sessionView(current.value), turns, offset, hasMore: listed.value.hasMore } };
    },
  };
}
