import { z } from "zod";
import { resolveRequestActor } from "@/lib/supabase/request";
import { readTranslationRun } from "@/lib/agent/read-translation-run";
import { createTranslationRunAccess } from "@/lib/agent/translation-run-access";
import { readBoundedJson } from "@/lib/http/read-bounded-json";

export const runtime = "nodejs";
const id = z.uuid().transform(value => value.toLowerCase());
const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const statuses = { forbidden: 403, not_found: 404, invalid: 422, quota_exhausted: 429, busy: 409, unavailable: 503, cancelled: 409 };
type Context = { params: Promise<{ runId: string }> };
const cancellation = z.strictObject({ operation: z.literal("cancel"), accountId: id });

/** Cookie-only recovery, independent of all generation credentials and feature flags. */
export async function GET(request: Request, context: Context) {
  if (request.headers.has("authorization")) return reply({ ok: false, code: "forbidden" }, 403);
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return reply(identity, identity.code === "unauthenticated" ? 401 : 503);
    const query = [...new URL(request.url).searchParams.entries()];
    const accountId = id.safeParse(query.length === 1 && query[0][0] === "accountId" ? query[0][1] : null);
    const runId = id.safeParse((await context.params).runId);
    if (!accountId.success || !runId.success) return reply({ ok: false, code: "invalid" }, 422);
    if (identity.value.actor.client !== "web" || identity.value.actor.userId !== accountId.data) return reply({ ok: false, code: "forbidden" }, 403);
    const result = await readTranslationRun(identity.value.client, identity.value.actor, runId.data, request.signal);
    return reply(result, result.ok ? 200 : statuses[result.code]);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}

/** Explicit cancellation is a state transition, not deletion or a generation retry. */
export async function POST(request: Request, context: Context) {
  const origin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (request.headers.get("origin") !== origin || request.headers.has("authorization")) return reply({ ok: false, code: "forbidden" }, 403);
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return reply(identity, identity.code === "unauthenticated" ? 401 : 503);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ ok: false, code: "invalid" }, 422);
    const body = await readBoundedJson(request, 32 * 1024);
    if (!body.ok) return reply({ ok: false, code: "invalid" }, body.status);
    const command = cancellation.safeParse(body.value), runId = id.safeParse((await context.params).runId);
    if (!command.success || !runId.success) return reply({ ok: false, code: "invalid" }, 422);
    if (identity.value.actor.client !== "web" || identity.value.actor.userId !== command.data.accountId) return reply({ ok: false, code: "forbidden" }, 403);
    const result = await createTranslationRunAccess(identity.value.client, identity.value.actor).cancel(runId.data);
    return result.ok ? reply({ ok: true, runId: result.run.id, status: result.run.status }, 200) : reply(result, statuses[result.code]);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}
