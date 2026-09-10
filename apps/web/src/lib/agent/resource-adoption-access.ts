import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseResourceAdoption, type ResourceAdoption } from "./resource-adoption";
import { resourceRunFailure } from "./resource-run-access";

export type ResourceAdoptionResponse = { ok: true; adoption: ResourceAdoption } | ReturnType<typeof resourceRunFailure>;
export function adoptionFailure(error: { code?: string; message?: string }): ReturnType<typeof resourceRunFailure> {
  if (error.code === "P0001" && error.message === "RESOURCE_ADOPTION_QUOTA_EXHAUSTED") return { ok: false, code: "quota_exhausted" };
  if (error.code === "P0001" && error.message === "RESOURCE_ADOPTION_BUSY") return { ok: false, code: "busy" };
  return resourceRunFailure(error);
}
/** Only authenticated user RPCs; review/cancel/reject/confirm need no provider credential. */
export function createResourceAdoptionAccess(client: SupabaseClient, identity: Actor) {
  const actor = { ...identity }, allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  async function command(name: "read_resource_adoption" | "cancel_resource_adoption" | "reject_resource_adoption", id: string): Promise<ResourceAdoptionResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    if (!z.uuid().safeParse(id).success) return { ok: false, code: "invalid" };
    try {
      const { data, error } = await client.rpc(name, { p_adoption_id: id });
      return error ? adoptionFailure(error) : { ok: true, adoption: parseResourceAdoption(data, actor.userId, id) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  const read = (id: string) => command("read_resource_adoption", id);
  return { read, cancel: (id: string) => command("cancel_resource_adoption", id), reject: (id: string) => command("reject_resource_adoption", id),
    async apply(id: string, proposalId: string, expectedVersion: number): Promise<ResourceAdoptionResponse> {
      if (!z.uuid().safeParse(proposalId).success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return { ok: false, code: "invalid" };
      const state = await read(id);
      if (!state.ok) return state;
      if (state.adoption.proposalId !== proposalId || state.adoption.blueprintVersion !== expectedVersion) return { ok: false, code: "version_conflict" };
      try {
        const { error } = await client.rpc("apply_blueprint_proposal", { proposal_id: proposalId, expected_version: expectedVersion, mutation_id: proposalId });
        return error ? adoptionFailure(error) : read(id);
      } catch { return { ok: false, code: "unavailable" }; }
    },
  };
}
