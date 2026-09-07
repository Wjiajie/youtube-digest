import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { blueprintApplication } from "@/lib/application";
import { resultResponse } from "@/lib/http";
import { extensionRequestActor } from "@/lib/supabase/request";

export async function GET(request: NextRequest) {
  const context = await extensionRequestActor(request);
  if (!context) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
  try {
    return resultResponse(await blueprintApplication(context.client).getMainBlueprint(context.actor));
  } catch {
    return NextResponse.json({ code: "unavailable" }, { status: 503 });
  }
}
