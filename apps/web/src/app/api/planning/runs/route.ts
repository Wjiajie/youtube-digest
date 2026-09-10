import { z } from "zod";
import { resolveRequestActor } from "@/lib/supabase/request";
import { startPlanningRunSchema } from "@/lib/agent/planning-run";
import { createCloudPathPlanner } from "@/lib/agent/cloud-path-planner";
import { planningConfiguration, createPlanningModel, createPlanningWorker } from "@/lib/agent/planning-runtime";

export const runtime = "nodejs";
export const maxDuration = 90;
const inputSchema = startPlanningRunSchema.extend({ accountId: z.uuid() });
function reply(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Dedicated request avoids serializing long generation with cancellation Server Actions. */
export async function POST(request: Request) {
  // Next's request URL may use its internal listener hostname. Browser-controlled
  // Origin must match the actual HTTP Host, never an arbitrary forwarded host.
  const expectedOrigin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (request.headers.get("origin") !== expectedOrigin || request.headers.has("authorization"))
    return reply({ ok: false, code: "forbidden" }, 403);
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return reply(identity, identity.code === "unauthenticated" ? 401 : 503);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ ok: false, code: "invalid" }, 422);
    const reader = request.body?.getReader();
    if (!reader) return reply({ ok: false, code: "invalid" }, 422);
    let size = 0, text = ""; const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2048) { await reader.cancel(); return reply({ ok: false, code: "invalid" }, 413); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(text); } catch { return reply({ ok: false, code: "invalid" }, 422); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return reply({ ok: false, code: "invalid" }, 422);
    const { accountId, ...command } = parsed.data;
    if (accountId !== identity.value.actor.userId || identity.value.actor.client !== "web") return reply({ ok: false, code: "forbidden" }, 403);
    const configuration = planningConfiguration();
    if (!configuration) return reply({ ok: false, code: "disabled" }, 503);
    const session = await identity.value.client.auth.getSession();
    if (session.error || !session.data.session) return reply({ ok: false, code: "unauthenticated" }, 401);
    // The token is only forwarded; the Edge worker independently verifies its identity.
    const result = await createCloudPathPlanner({ ...identity.value, worker: createPlanningWorker(configuration, session.data.session.access_token),
      model: createPlanningModel(configuration.apiKey) }).run(command, request.signal);
    if (result.ok) return reply({ ok: true, runId: result.run.id, status: result.run.status }, 200);
    const statuses = { forbidden: 403, invalid: 422, not_found: 404, version_conflict: 409, quota_exhausted: 429,
      busy: 409, unavailable: 503, cancelled: 409, input_too_large: 413 };
    return reply(result, statuses[result.code]);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}
