import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@blueprint/domain";
import {
  appearanceSchema,
  defaultPreferences,
  type Message,
  type PendingAction,
} from "./contracts";

export type CompanionContext = {
  client: SupabaseClient;
  actor: Actor;
  conversationId: string;
};
export function checked<T>(result: { data: T; error: any }): T {
  if (result.error) throw new Error(result.error.code ?? "unavailable");
  return result.data;
}
export async function openConversation(client: SupabaseClient, actor: Actor) {
  checked(
    await client
      .from("companion_conversations")
      .upsert(
        { owner_id: actor.userId },
        { onConflict: "owner_id", ignoreDuplicates: true },
      ),
  );
  const row = checked(
    await client
      .from("companion_conversations")
      .select("id")
      .eq("owner_id", actor.userId)
      .single(),
  );
  if (!row) throw new Error("unavailable");
  return row.id as string;
}
export async function readMessages(ctx: CompanionContext, before?: string) {
  let q = ctx.client
    .from("companion_messages")
    .select("id,role,text,modality,interrupted,created_at")
    .eq("owner_id", ctx.actor.userId)
    .eq("conversation_id", ctx.conversationId);
  if (before) q = q.lt("created_at", before);
  return (
    checked(
      await q
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50),
    ) as Message[]
  ).reverse();
}
export async function appendMessage(
  ctx: CompanionContext,
  id: string,
  role: Message["role"],
  text: string,
  modality: Message["modality"],
  interrupted = false,
) {
  if (!text.trim()) return;
  checked(
    await ctx.client.from("companion_messages").insert({
      id,
      owner_id: ctx.actor.userId,
      conversation_id: ctx.conversationId,
      role,
      text: text.slice(0, 16000),
      modality,
      interrupted,
    }),
  );
}
export async function readActions(ctx: CompanionContext) {
  return checked(
    await ctx.client
      .from("companion_actions")
      .select("*")
      .eq("owner_id", ctx.actor.userId)
      .eq("conversation_id", ctx.conversationId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
  ) as PendingAction[];
}
export async function propose(
  ctx: CompanionContext,
  sourceMessageId: string,
  callKey: string,
  kind: PendingAction["kind"],
  payload: Record<string, unknown>,
) {
  const old = checked(
    await ctx.client
      .from("companion_actions")
      .select("*")
      .eq("owner_id", ctx.actor.userId)
      .eq("call_key", callKey)
      .maybeSingle(),
  );
  if (old) return old as PendingAction;
  const result = await ctx.client
    .from("companion_actions")
    .insert({
      id: crypto.randomUUID(),
      owner_id: ctx.actor.userId,
      conversation_id: ctx.conversationId,
      source_message_id: sourceMessageId,
      call_key: callKey,
      kind,
      payload,
    })
    .select()
    .single();
  if (result.error?.code === "23505")
    return checked(
      await ctx.client
        .from("companion_actions")
        .select("*")
        .eq("owner_id", ctx.actor.userId)
        .eq("call_key", callKey)
        .single(),
    ) as PendingAction;
  return checked(result) as PendingAction;
}
export async function preferences(client: SupabaseClient, actor: Actor) {
  const row = checked(
    await client
      .from("companion_preferences")
      .select("value,revision")
      .eq("owner_id", actor.userId)
      .maybeSingle(),
  );
  return {
    value: row ? appearanceSchema.parse(row.value) : defaultPreferences,
    revision: row?.revision ?? 0,
  };
}
export async function savePreferences(
  client: SupabaseClient,
  actor: Actor,
  value: unknown,
  revision: number,
) {
  const parsed = appearanceSchema.parse(value);
  if (revision === 0)
    checked(
      await client
        .from("companion_preferences")
        .insert({ owner_id: actor.userId, value: parsed }),
    );
  else {
    const row = checked(
      await client
        .from("companion_preferences")
        .update({ value: parsed, revision: revision + 1 })
        .eq("owner_id", actor.userId)
        .eq("revision", revision)
        .select("revision")
        .maybeSingle(),
    );
    if (!row) throw new Error("40001");
  }
  return { value: parsed, revision: revision + 1 };
}
