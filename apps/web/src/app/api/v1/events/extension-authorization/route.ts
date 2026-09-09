import { NextResponse } from "next/server";
import { z } from "zod";

import { resultResponse } from "@/lib/http";
import { recordProductEvent } from "@/lib/product-events";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function POST(request: Request) {
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return resultResponse(identity);
    const context = identity.value;
    const parsed = z.object({ decision: z.enum(["approved", "denied"]) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ code: "invalid" }, { status: 422 });
    await recordProductEvent(
      context.client,
      context.actor,
      parsed.data.decision === "approved" ? "extension_authorized" : "extension_denied",
    );
    return NextResponse.json({ ok: true });
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}
