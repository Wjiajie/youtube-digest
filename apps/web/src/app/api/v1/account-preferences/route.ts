import type { NextRequest } from "next/server";

import { readAccountPreferences } from "@/lib/account-preferences";
import { resultResponse } from "@/lib/http";
import { requestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  try {
    const context = await requestActor(request);
    const response = resultResponse(context
      ? await readAccountPreferences(context.client, context.actor)
      : { ok: false, code: "unauthenticated" });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    const response = resultResponse({ ok: false, code: "unavailable" });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
