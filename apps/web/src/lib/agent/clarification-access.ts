import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { goalBriefContentSchema, goalBriefSchema, type Actor } from "@blueprint/domain";
import { parseClarificationSession, parseClarificationTurn, type ClarificationSession, type ClarificationTurn } from "./clarification-records";

export type ClarificationFailure = { ok: false; code: "forbidden" | "invalid" | "not_found" | "version_conflict" | "busy" | "quota_exhausted" | "window_full" | "cancelled" | "unavailable" };
export type ClarificationResponse<T> = { ok: true; value: T } | ClarificationFailure;
export function clarificationFailure(error: { code?: string; message?: string }): ClarificationFailure {
  if (error.code === "42501") return { ok: false, code: "forbidden" };
  if (error.code === "P0002") return { ok: false, code: "not_found" };
  if (error.code === "40001") return { ok: false, code: "version_conflict" };
  if (["22023", "23514"].includes(error.code ?? "")) return { ok: false, code: "invalid" };
  if (error.code === "P0001" && error.message === "CLARIFICATION_BUSY") return { ok: false, code: "busy" };
  if (error.code === "P0001" && error.message === "CLARIFICATION_QUOTA_EXHAUSTED") return { ok: false, code: "quota_exhausted" };
  if (error.code === "P0001" && error.message === "CLARIFICATION_WINDOW_FULL") return { ok: false, code: "window_full" };
  return { ok: false, code: "unavailable" };
}
const revision = z.int().min(1).max(2147483646);
const createSchema = z.strictObject({ sessionId: z.uuid(), briefId: z.uuid(), expectedBriefRevision: revision });
const editSchema = z.strictObject({ sessionId: z.uuid(), expectedRevision: revision, content: goalBriefContentSchema, clientMutationId: z.uuid() });
const saveSchema = z.strictObject({ sessionId: z.uuid(), expectedRevision: revision, confirm: z.boolean(), clientMutationId: z.uuid() });
const savedRow = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), blueprint_id: z.uuid(), revision: z.int().positive(),
  status: z.enum(["draft", "confirmed"]), content: goalBriefContentSchema, updated_at: z.iso.datetime({ offset: true }) });
const listedSession = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), brief_id: z.uuid(), created_at: z.iso.datetime({ offset: true }) });
const listedTurn = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), session_id: z.uuid(), ordinal: z.int().positive(),
  status: z.enum(["queued", "running", "ready", "failed", "cancelled", "interrupted", "stale"]), created_at: z.iso.datetime({ offset: true }) });

/** User-owned recovery and explicit editing need neither an inference model nor a worker secret. */
export function createClarificationAccess(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity };
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  async function call<T>(name: string, args: Record<string, unknown>, parse: (data: unknown) => T): Promise<ClarificationResponse<T>> {
    try {
      const { data, error } = await client.rpc(name, args);
      return error ? clarificationFailure(error) : { ok: true, value: parse(data) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  async function turnCommand(name: "read_goal_clarification_turn" | "cancel_goal_clarification_turn", turnId: string): Promise<ClarificationResponse<ClarificationTurn>> {
    if (!allowed) return { ok: false, code: "forbidden" };
    if (!z.uuid().safeParse(turnId).success) return { ok: false, code: "invalid" };
    return call(name, { p_turn_id: turnId }, data => parseClarificationTurn(data, actor.userId, turnId));
  }
  return {
    readTurn: (turnId: string) => turnCommand("read_goal_clarification_turn", turnId),
    cancelTurn: (turnId: string) => turnCommand("cancel_goal_clarification_turn", turnId),
    async list(briefId: string, offset = 0) {
      if (!allowed) return { ok: false as const, code: "forbidden" as const };
      if (!z.uuid().safeParse(briefId).success || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return { ok: false as const, code: "invalid" as const };
      try {
        const { data, error } = await client.from("goal_clarification_sessions").select("id,owner_id,brief_id,created_at")
          .eq("owner_id", actor.userId).eq("brief_id", briefId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 20);
        if (error) return clarificationFailure(error);
        const rows = z.array(listedSession).max(21).parse(data);
        if (rows.some(row => row.owner_id !== actor.userId || row.brief_id !== briefId)) throw new Error("Invalid clarification listing");
        return { ok: true as const, value: { items: rows.slice(0, 20).map(row => ({ id: row.id, createdAt: row.created_at })), hasMore: rows.length > 20 } };
      } catch { return { ok: false as const, code: "unavailable" as const }; }
    },
    async listTurns(sessionId: string, offset = 0) {
      if (!allowed) return { ok: false as const, code: "forbidden" as const };
      if (!z.uuid().safeParse(sessionId).success || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return { ok: false as const, code: "invalid" as const };
      try {
        const { data, error } = await client.from("goal_clarification_turns").select("id,owner_id,session_id,ordinal,status,created_at")
          .eq("owner_id", actor.userId).eq("session_id", sessionId).order("ordinal", { ascending: false }).range(offset, offset + 20);
        if (error) return clarificationFailure(error);
        const rows = z.array(listedTurn).max(21).parse(data);
        if (rows.some(row => row.owner_id !== actor.userId || row.session_id !== sessionId)) throw new Error("Invalid clarification turn listing");
        return { ok: true as const, value: { items: rows.slice(0, 20).map(row => ({ id: row.id, ordinal: row.ordinal, status: row.status, createdAt: row.created_at })), hasMore: rows.length > 20 } };
      } catch { return { ok: false as const, code: "unavailable" as const }; }
    },
    async create(input: unknown): Promise<ClarificationResponse<ClarificationSession>> {
      if (!allowed) return { ok: false, code: "forbidden" };
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const command = parsed.data;
      return call("create_goal_clarification", { p_session_id: command.sessionId, p_brief_id: command.briefId,
        p_expected_brief_revision: command.expectedBriefRevision }, data => {
        const session = parseClarificationSession(data, actor.userId, command.sessionId);
        if (session.briefId !== command.briefId || session.briefRevision !== command.expectedBriefRevision) throw new Error("Invalid creation receipt");
        return session;
      });
    },
    async read(sessionId: string): Promise<ClarificationResponse<ClarificationSession>> {
      if (!allowed) return { ok: false, code: "forbidden" };
      if (!z.uuid().safeParse(sessionId).success) return { ok: false, code: "invalid" };
      return call("read_goal_clarification", { p_session_id: sessionId }, data => parseClarificationSession(data, actor.userId, sessionId));
    },
    async edit(input: unknown): Promise<ClarificationResponse<ClarificationSession>> {
      if (!allowed) return { ok: false, code: "forbidden" };
      const parsed = editSchema.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid" };
      const command = parsed.data;
      return call("edit_goal_clarification", { p_session_id: command.sessionId, p_expected_revision: command.expectedRevision,
        p_content: command.content, p_client_mutation_id: command.clientMutationId }, data => {
        const session = parseClarificationSession(data, actor.userId, command.sessionId);
        if (session.revision !== command.expectedRevision + 1 || JSON.stringify(session.content) !== JSON.stringify(command.content)) throw new Error("Invalid edit receipt");
        return session;
      });
    },
    async save(input: unknown) {
      if (!allowed) return { ok: false as const, code: "forbidden" as const };
      const parsed = saveSchema.safeParse(input);
      if (!parsed.success) return { ok: false as const, code: "invalid" as const };
      const command = parsed.data;
      return call("save_goal_clarification", { p_session_id: command.sessionId, p_expected_revision: command.expectedRevision,
        p_confirm: command.confirm, p_client_mutation_id: command.clientMutationId }, data => {
        const receipt = z.strictObject({ session: z.unknown(), brief: savedRow }).parse(data);
        const session = parseClarificationSession(receipt.session, actor.userId, command.sessionId), row = receipt.brief;
        const brief = goalBriefSchema.parse({ id: row.id, blueprintId: row.blueprint_id, revision: row.revision,
          status: row.status, content: row.content, updatedAt: row.updated_at });
        if (row.owner_id !== actor.userId || brief.id !== session.briefId || brief.blueprintId !== session.blueprintId
          || session.status !== "closed" || session.revision !== command.expectedRevision + 1 || brief.revision !== session.briefRevision + 1
          || brief.status !== (command.confirm ? "confirmed" : "draft") || JSON.stringify(brief.content) !== JSON.stringify(session.content)) throw new Error("Invalid save receipt");
        return { session, brief };
      });
    },
  };
}
