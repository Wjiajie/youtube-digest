import type { NextRequest } from "next/server";
import { recordProgressEvidence, readRecentProgressEvidence } from "@/lib/progress-evidence";
import { resultResponse } from "@/lib/http";
import { resolveExtensionRequestActor, resolveRequestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveRequestActor(request);
    return resultResponse(context.ok
      ? await readRecentProgressEvidence(context.value.client, context.value.actor) : context);
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}

// Web mutations use the account-bound Server Action and Next's origin checks.
export async function POST(request: NextRequest) {
  try {
    const context = await resolveExtensionRequestActor(request);
    if (!context.ok) return resultResponse(context);
    let input: unknown;
    try { input = await request.json(); }
    catch { return resultResponse({ ok: false, code: "invalid" }); }
    return resultResponse(await recordProgressEvidence(context.value.client, context.value.actor, input));
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}
