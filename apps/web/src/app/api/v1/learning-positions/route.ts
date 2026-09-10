import { NextResponse, type NextRequest } from "next/server";
import { recordLearningPosition, readLearningPositionWorkspace } from "@/lib/learning-positions";
import { resultResponse } from "@/lib/http";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { resolveExtensionRequestActor, resolveRequestActor } from "@/lib/supabase/request";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveRequestActor(request);
    if (!context.ok) return resultResponse(context);
    const query = request.nextUrl.searchParams;
    if ([...query.keys()].some(key => key !== "resourceBindingId") || query.getAll("resourceBindingId").length > 1) return resultResponse({ ok: false, code: "invalid" });
    return resultResponse(await readLearningPositionWorkspace(context.value.client, context.value.actor, query.get("resourceBindingId") ?? undefined));
  } catch { return resultResponse({ ok: false, code: "unavailable" }); }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveExtensionRequestActor(request);
    if (!context.ok) return resultResponse(context);
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return resultResponse({ ok: false, code: "invalid" });
    const body = await readBoundedJson(request, 65_536);
    if (!body.ok) return NextResponse.json({ code: "invalid" }, { status: body.status, headers: { "Cache-Control": "private, no-store" } });
    return resultResponse(await recordLearningPosition(context.value.client, context.value.actor, body.value));
  } catch { return resultResponse({ ok: false, code: "unavailable" }); }
}
