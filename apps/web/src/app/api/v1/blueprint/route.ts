import type { NextRequest } from "next/server";

import { blueprintApplication } from "@/lib/application";
import { resultResponse } from "@/lib/http";
import { resolveExtensionRequestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  try {
    const identity = await resolveExtensionRequestActor(request);
    if (!identity.ok) return resultResponse(identity);
    const context = identity.value;
    return resultResponse(await blueprintApplication(context.client).getMainBlueprint(context.actor));
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}
