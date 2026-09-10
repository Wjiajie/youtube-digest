import type { NextRequest } from "next/server";
import { readLearningTranscript } from "@/lib/learning-transcript";
import { resultResponse } from "@/lib/http";
import { resolveRequestActor } from "@/lib/supabase/request";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveRequestActor(request);
    if (!context.ok) return resultResponse(context);
    const query = request.nextUrl.searchParams;
    if ([...query.keys()].some(key => !["bindingId", "videoId", "sourceRunId", "offset"].includes(key) || query.getAll(key).length !== 1)
      || query.has("offset") && !/^(0|[1-9]\d{0,4})$/.test(query.get("offset")!)) return resultResponse({ ok: false, code: "invalid" });
    return resultResponse(await readLearningTranscript(context.value.client, context.value.actor, {
      bindingId: query.get("bindingId"), videoId: query.get("videoId"), sourceRunId: query.get("sourceRunId"), offset: Number(query.get("offset") ?? 0),
    }));
  } catch { return resultResponse({ ok: false, code: "unavailable" }); }
}
