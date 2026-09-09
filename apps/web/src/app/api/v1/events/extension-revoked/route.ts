import { NextResponse } from "next/server";

import { resultResponse } from "@/lib/http";
import { recordProductEvent } from "@/lib/product-events";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function POST() {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return resultResponse(identity);
    const context = identity.value;
    await recordProductEvent(context.client, context.actor, "extension_revoked");
    return NextResponse.json({ ok: true });
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}
