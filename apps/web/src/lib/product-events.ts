import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@blueprint/domain";

export type ProductEventName =
  | "auth_succeeded"
  | "auth_failed"
  | "extension_authorized"
  | "extension_denied"
  | "extension_revoked"
  | "blueprint_viewed"
  | "proposal_created"
  | "proposal_applied"
  | "proposal_rejected"
  | "proposal_conflict"
  | "learning_session_started"
  | "sync_failed"
  | "sync_recovered";

export async function recordProductEvent(
  client: SupabaseClient<any, any, any, any, any>,
  actor: Actor,
  eventName: ProductEventName,
  details: {
    entityType?: "blueprint" | "proposal" | "path_node" | "learning_session";
    entityId?: string;
    resultCode?: string;
    durationBucket?: "lt_100ms" | "lt_1s" | "lt_5s" | "gte_5s";
  } = {},
): Promise<void> {
  try {
    await client.from("product_events").insert({
      owner_id: actor.userId,
      event_name: eventName,
      surface: actor.client,
      entity_type: details.entityType ?? null,
      entity_id: details.entityId ?? null,
      result_code: details.resultCode ?? null,
      duration_bucket: details.durationBucket ?? null,
    });
  } catch {
    // Observability is deliberately best-effort and never changes product outcomes.
  }
}
