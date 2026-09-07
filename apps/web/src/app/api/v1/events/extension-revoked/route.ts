import { NextResponse } from "next/server";

import { recordProductEvent } from "@/lib/product-events";
import { requestActor } from "@/lib/supabase/request";

export async function POST() {
  const context = await requestActor();
  if (!context) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  await recordProductEvent(context.client, context.actor, "extension_revoked");
  return NextResponse.json({ ok: true });
}
