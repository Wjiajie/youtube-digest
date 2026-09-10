import { z } from "zod";
import { authFailure, resolveRequestActor } from "@/lib/supabase/request";
import { createCloudGoalClarifier } from "@/lib/agent/cloud-goal-clarifier";
import { clarificationConfiguration, createClarificationWorker } from "@/lib/agent/clarification-runtime";
import { createPlanningModel } from "@/lib/agent/planning-runtime";

export const runtime = "nodejs";
export const maxDuration = 90;
const inputSchema = z.strictObject({ accountId: z.uuid(), turnId: z.uuid(), sessionId: z.uuid(),
  expectedRevision: z.int().min(1).max(2147483646), message: z.string().min(1).max(8000).refine(value => value.trim().length > 0) });
const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Dedicated generation request leaves read/cancel Server Actions independently usable. */
export async function POST(request: Request) {
  const origin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (request.headers.get("origin") !== origin || request.headers.has("authorization")) return reply({ ok: false, code: "forbidden" }, 403);
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return reply(identity, identity.code === "unauthenticated" ? 401 : 503);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ ok: false, code: "invalid" }, 422);
    const reader = request.body?.getReader();
    if (!reader) return reply({ ok: false, code: "invalid" }, 422);
    let size = 0, text = "", timer: ReturnType<typeof setTimeout> | undefined;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DOMException("Read deadline", "TimeoutError")), 5_000); });
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 64 * 1024) { void reader.cancel().catch(() => {}); return reply({ ok: false, code: "invalid" }, 413); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      void reader.cancel().catch(() => {});
      return reply({ ok: false, code: "invalid" }, error instanceof DOMException && error.name === "TimeoutError" ? 408 : 422);
    } finally { clearTimeout(timer); reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(text); } catch { return reply({ ok: false, code: "invalid" }, 422); }
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return reply({ ok: false, code: "invalid" }, 422);
    const { accountId, ...command } = parsed.data;
    if (identity.value.actor.userId !== accountId || identity.value.actor.client !== "web") return reply({ ok: false, code: "forbidden" }, 403);
    const configuration = clarificationConfiguration();
    if (!configuration) return reply({ ok: false, code: "disabled" }, 503);
    const session = await identity.value.client.auth.getSession();
    if (session.error) {
      const failure = authFailure(session.error);
      return reply(failure, failure.code === "unauthenticated" ? 401 : 503);
    }
    if (!session.data.session) return reply({ ok: false, code: "unauthenticated" }, 401);
    const result = await createCloudGoalClarifier({ ...identity.value, model: createPlanningModel(configuration.apiKey),
      worker: createClarificationWorker(configuration, session.data.session.access_token) }).run(command, request.signal);
    if (result.ok) return reply({ ok: true, turnId: result.value.id, status: result.value.status }, 200);
    const statuses = { forbidden: 403, invalid: 422, not_found: 404, version_conflict: 409, busy: 409,
      quota_exhausted: 429, window_full: 409, cancelled: 409, unavailable: 503 };
    return reply(result, statuses[result.code]);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}
