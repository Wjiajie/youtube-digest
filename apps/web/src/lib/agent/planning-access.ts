import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePlanningRun, type PlanningRun } from "./planning-run";

type FailureCode = "forbidden" | "invalid" | "not_found" | "version_conflict" | "quota_exhausted" | "busy" | "unavailable" | "cancelled";
export type RunResponse = { ok: true; run: PlanningRun } | { ok: false; code: FailureCode };
export function planningFailure(error: { code?: string; message?: string }): { ok: false; code: FailureCode } {
  if (error.code === "42501") return { ok: false, code: "forbidden" };
  if (error.code === "P0002") return { ok: false, code: "not_found" };
  if (error.code === "40001") return { ok: false, code: "version_conflict" };
  if (["22023", "23514"].includes(error.code ?? "")) return { ok: false, code: "invalid" };
  if (error.code === "P0001" && error.message === "PATH_PLANNING_QUOTA_EXHAUSTED") return { ok: false, code: "quota_exhausted" };
  if (error.code === "P0001" && error.message === "PATH_PLANNING_BUSY") return { ok: false, code: "busy" };
  return { ok: false, code: "unavailable" };
}

const listingRow = z.strictObject({ id: z.uuid(), owner_id: z.uuid(), brief_id: z.uuid(), created_at: z.iso.datetime({ offset: true }) });
/** User-only access. No model or worker credential is needed to recover saved work. */
export function createPlanningRunAccess(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity };
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  async function command(name: "read_path_planning" | "cancel_path_planning", runId: string): Promise<RunResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    if (!z.uuid().safeParse(runId).success) return { ok: false, code: "invalid" };
    try {
      const { data, error } = await client.rpc(name, { p_run_id: runId });
      if (error) return planningFailure(error);
      return { ok: true, run: parsePlanningRun(data, actor.userId, runId) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return {
    read: (runId: string) => command("read_path_planning", runId),
    cancel: (runId: string) => command("cancel_path_planning", runId),
    async list(briefId: string, offset = 0) {
      if (!allowed) return { ok: false as const, code: "forbidden" as const };
      if (!z.uuid().safeParse(briefId).success || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000)
        return { ok: false as const, code: "invalid" as const };
      try {
        const { data, error } = await client.from("path_planning_runs").select("id,owner_id,brief_id,created_at")
          .eq("owner_id", actor.userId).eq("brief_id", briefId)
          .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 20);
        if (error) return planningFailure(error);
        const rows = z.array(listingRow).max(21).parse(data);
        if (rows.some(row => row.owner_id !== actor.userId || row.brief_id !== briefId)) throw new Error("Invalid planning list identity");
        return { ok: true as const, value: { runs: rows.slice(0, 20).map(row => ({ id: row.id, createdAt: row.created_at })), hasMore: rows.length > 20 } };
      } catch { return { ok: false as const, code: "unavailable" as const }; }
    },
  };
}
