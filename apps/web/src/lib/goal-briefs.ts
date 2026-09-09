import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { goalBriefSchema, saveGoalBriefSchema, type Actor, type ApplicationResult, type GoalBrief } from "@blueprint/domain";

export async function saveGoalBrief(client: SupabaseClient, actor: Actor, input: unknown): Promise<ApplicationResult<GoalBrief>> {
  if (actor.client !== "web") return { ok: false, code: "forbidden" };
  const parsed = saveGoalBriefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const command = parsed.data;
  const { data, error } = await client.rpc("save_goal_brief", {
    p_id: command.id, p_expected_revision: command.expectedRevision, p_content: command.content,
    p_confirm: command.confirm, p_client_mutation_id: command.clientMutationId,
  });
  if (error) {
    switch (error.code) {
      case "P0002": return { ok: false, code: "not_found" };
      case "40001": return { ok: false, code: "version_conflict" };
      case "42501": return { ok: false, code: "forbidden" };
      case "22023":
      case "23514": return { ok: false, code: "invalid" };
      default: throw error;
    }
  }
  const receipt = fromRow(data, actor.userId);
  if (receipt.id !== command.id || receipt.revision !== command.expectedRevision + 1
    || receipt.status !== (command.confirm ? "confirmed" : "draft")
    || JSON.stringify(receipt.content) !== JSON.stringify(command.content)) throw new Error("Invalid Goal Brief receipt");
  return { ok: true, value: receipt };
}

export async function readGoalBrief(client: SupabaseClient, actor: Actor, id: string): Promise<ApplicationResult<GoalBrief>> {
  if (actor.client !== "web") return { ok: false, code: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, code: "invalid" };
  const { data, error } = await client.from("goal_briefs")
    .select("id,owner_id,blueprint_id,revision,status,content,updated_at")
    .eq("owner_id", actor.userId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, code: "not_found" };
  const brief = fromRow(data, actor.userId);
  if (brief.id !== id) throw new Error("Invalid Goal Brief identity");
  return { ok: true, value: brief };
}

function fromRow(row: Record<string, unknown>, ownerId: string): GoalBrief {
  if (!row || row.owner_id !== ownerId) throw new Error("Invalid Goal Brief owner");
  return goalBriefSchema.parse({ id: row.id, blueprintId: row.blueprint_id, revision: row.revision,
    status: row.status, content: row.content, updatedAt: row.updated_at });
}

export async function listGoalBriefs(client: SupabaseClient, actor: Actor, offset = 0): Promise<ApplicationResult<{ briefs: GoalBrief[]; hasMore: boolean }>> {
  if (actor.client !== "web") return { ok: false, code: "forbidden" };
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return { ok: false, code: "invalid" };
  const { data, error } = await client.from("goal_briefs")
    .select("id,owner_id,blueprint_id,revision,status,content,updated_at")
    .eq("owner_id", actor.userId).order("updated_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + 50);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Invalid Goal Brief list");
  const briefs = data.map(row => fromRow(row, actor.userId));
  return { ok: true, value: { briefs: briefs.slice(0, 50), hasMore: briefs.length > 50 } };
}
