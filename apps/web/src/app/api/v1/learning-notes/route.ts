import { NextResponse, type NextRequest } from "next/server";
import { recordLearningNote, readLearningNoteWorkspace } from "@/lib/learning-notes";
import { resultResponse } from "@/lib/http";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { resolveExtensionRequestActor, resolveRequestActor } from "@/lib/supabase/request";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveRequestActor(request);
    return resultResponse(context.ok ? await readLearningNoteWorkspace(context.value.client, context.value.actor) : context);
  } catch { return resultResponse({ ok: false, code: "unavailable" }); }
}

// Web writes use the bound Server Action and Next's own origin protection.
export async function POST(request: NextRequest) {
  try {
    const context = await resolveExtensionRequestActor(request);
    if (!context.ok) return resultResponse(context);
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return resultResponse({ ok: false, code: "invalid" });
    }
    const body = await readBoundedJson(request, 65_536);
    if (!body.ok) return NextResponse.json({ code: "invalid" }, { status: body.status, headers: { "Cache-Control": "private, no-store" } });
    return resultResponse(await recordLearningNote(context.value.client, context.value.actor, body.value));
  } catch { return resultResponse({ ok: false, code: "unavailable" }); }
}
