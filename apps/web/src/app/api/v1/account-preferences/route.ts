import type { NextRequest } from "next/server";

import { readAccountPreferences } from "@/lib/account-preferences";
import { resultResponse } from "@/lib/http";
import { resolveRequestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveRequestActor(request);
    const response = resultResponse(context.ok
      ? await readAccountPreferences(context.value.client, context.value.actor)
      : context);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    const response = resultResponse({ ok: false, code: "unavailable" });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
