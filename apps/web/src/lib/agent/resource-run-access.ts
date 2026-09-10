import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseResourceRun, type ResourceRun } from "./resource-run";

type FailureCode = "forbidden" | "invalid" | "not_found" | "version_conflict" | "quota_exhausted" | "busy" | "unavailable" | "cancelled" | "input_too_large";
export type ResourceRunResponse = { ok: true; run: ResourceRun } | { ok: false; code: FailureCode };
export function resourceRunFailure(error: { code?: string; message?: string }): { ok: false; code: FailureCode } {
  if (error.code === "42501") return { ok: false, code: "forbidden" };
  if (error.code === "P0002") return { ok: false, code: "not_found" };
  if (error.code === "40001") return { ok: false, code: "version_conflict" };
  if (["22023", "23514"].includes(error.code ?? "")) return { ok: false, code: "invalid" };
  if (error.code === "P0001" && error.message === "RESOURCE_QUOTA_EXHAUSTED") return { ok: false, code: "quota_exhausted" };
  if (error.code === "P0001" && error.message === "RESOURCE_BUSY") return { ok: false, code: "busy" };
  return { ok: false, code: "unavailable" };
}
/** Recovery never invokes a provider or requires a worker credential. */
export function createResourceRunAccess(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity };
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  async function command(name: "read_resource_run" | "cancel_resource_run" | "clear_resource_evidence", runId: string): Promise<ResourceRunResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    if (!z.uuid().safeParse(runId).success) return { ok: false, code: "invalid" };
    try {
      const { data, error } = await client.rpc(name, { p_run_id: runId });
      return error ? resourceRunFailure(error) : { ok: true, run: parseResourceRun(data, actor.userId, runId) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return { read: (id: string) => command("read_resource_run", id), cancel: (id: string) => command("cancel_resource_run", id), clear: (id: string) => command("clear_resource_evidence", id) };
}
