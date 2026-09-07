import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { blueprintApplication } from "@/lib/application";
import { resultResponse } from "@/lib/http";
import { recordProductEvent } from "@/lib/product-events";
import { extensionRequestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  const context = await extensionRequestActor(request);
  if (!context) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  try {
    return resultResponse(await blueprintApplication(context.client).listLearningSessions(context.actor));
  } catch {
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const context = await extensionRequestActor(request);
  if (!context) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  try {
    const input = await request.json();
    const result = await blueprintApplication(context.client).startLearningSession(context.actor, input);
    await recordProductEvent(context.client, context.actor, "learning_session_started", {
      entityType: "path_node",
      entityId: input.nodeId,
      ...(!result.ok ? { resultCode: result.code } : {}),
    });
    return resultResponse(result);
  } catch {
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }
}
