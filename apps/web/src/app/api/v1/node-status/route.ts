import type { NextRequest } from "next/server";
import { confirmNodeStatus, readNodeStatusWorkspace } from "@/lib/node-status";
import { resultResponse } from "@/lib/http";
import { resolveExtensionRequestActor, resolveRequestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  try {
    const identity = await resolveRequestActor(request);
    if (!identity.ok) return resultResponse(identity);
    return resultResponse(await readNodeStatusWorkspace(identity.value.client, identity.value.actor));
  } catch { return resultResponse({ ok: false, code: "unavailable" }); }
}

// Web writes use the bound Server Action and Next origin protection.
export async function POST(request: NextRequest) {
  try {
    const identity = await resolveExtensionRequestActor(request);
    if (!identity.ok) return resultResponse(identity);
    let input: unknown;
    try { input = await request.json(); } catch { return resultResponse({ ok: false, code: "invalid" }); }
    return resultResponse(await confirmNodeStatus(identity.value.client, identity.value.actor, input));
  } catch { return resultResponse({ ok: false, code: "unavailable" }); }
}
