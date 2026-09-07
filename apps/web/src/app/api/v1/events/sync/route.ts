import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordProductEvent } from "@/lib/product-events";
import { extensionRequestActor } from "@/lib/supabase/request";

export async function POST(request: NextRequest) {
  const context = await extensionRequestActor(request);
  if (!context) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  const parsed = z.object({ outcome: z.enum(["failed", "recovered"]), resultCode: z.string().max(64).optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid" }, { status: 422 });
  await recordProductEvent(
    context.client,
    context.actor,
    parsed.data.outcome === "failed" ? "sync_failed" : "sync_recovered",
    { resultCode: parsed.data.resultCode },
  );
  return NextResponse.json({ ok: true });
}
