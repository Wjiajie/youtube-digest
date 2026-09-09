import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { resultResponse } from "@/lib/http";
import { recordProductEvent } from "@/lib/product-events";
import { resolveExtensionRequestActor } from "@/lib/supabase/request";

export async function POST(request: NextRequest) {
  try {
    const identity = await resolveExtensionRequestActor(request);
    if (!identity.ok) return resultResponse(identity);
    const context = identity.value;
    const parsed = z.object({ outcome: z.enum(["failed", "recovered"]), resultCode: z.string().max(64).optional() }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ code: "invalid" }, { status: 422 });
    await recordProductEvent(
      context.client,
      context.actor,
      parsed.data.outcome === "failed" ? "sync_failed" : "sync_recovered",
      { resultCode: parsed.data.resultCode },
    );
    return NextResponse.json({ ok: true });
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}
