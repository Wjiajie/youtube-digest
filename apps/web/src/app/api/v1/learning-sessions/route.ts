import type { NextRequest } from "next/server";

import { blueprintApplication } from "@/lib/application";
import { resultResponse } from "@/lib/http";
import { recordProductEvent } from "@/lib/product-events";
import { resolveExtensionRequestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  try {
    const identity = await resolveExtensionRequestActor(request);
    if (!identity.ok) return resultResponse(identity);
    const context = identity.value;
    return resultResponse(await blueprintApplication(context.client).listLearningSessions(context.actor));
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await resolveExtensionRequestActor(request);
    if (!identity.ok) return resultResponse(identity);
    const context = identity.value;
    const input = await request.json();
    const result = await blueprintApplication(context.client).startLearningSession(context.actor, input);
    await recordProductEvent(context.client, context.actor, "learning_session_started", {
      entityType: "path_node",
      entityId: input.nodeId,
      ...(!result.ok ? { resultCode: result.code } : {}),
    });
    return resultResponse(result);
  } catch {
    return resultResponse({ ok: false, code: "unavailable" });
  }
}
