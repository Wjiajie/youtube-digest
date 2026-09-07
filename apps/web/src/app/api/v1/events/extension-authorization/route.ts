import { NextResponse } from "next/server";
import { z } from "zod";

import { recordProductEvent } from "@/lib/product-events";
import { requestActor } from "@/lib/supabase/request";

export async function POST(request: Request) {
  const context = await requestActor();
  if (!context) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  const parsed = z.object({ decision: z.enum(["approved", "denied"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid" }, { status: 422 });
  await recordProductEvent(
    context.client,
    context.actor,
    parsed.data.decision === "approved" ? "extension_authorized" : "extension_denied",
  );
  return NextResponse.json({ ok: true });
}
