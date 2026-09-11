import { z } from "zod";
import { authFailure, resolveRequestActor } from "@/lib/supabase/request";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { startTranslationRunSchema } from "@/lib/agent/translation-run-access";
import { createCloudTranslationRunner } from "@/lib/agent/cloud-translation-runner";
import { createRemoteTranslationWorker, translationConfiguration } from "@/lib/agent/translation-runtime";
import { createPlanningModel } from "@/lib/agent/planning-runtime";

export const runtime = "nodejs";
export const maxDuration = 90;
const inputSchema = startTranslationRunSchema.extend({ accountId: z.uuid().transform(value => value.toLowerCase()) });
const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Explicit execution only; reading an existing run never comes through this route. */
export async function POST(request: Request) {
  const origin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (request.headers.get("origin") !== origin || request.headers.has("authorization")) return reply({ ok: false, code: "forbidden" }, 403);
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return reply(identity, identity.code === "unauthenticated" ? 401 : 503);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ ok: false, code: "invalid" }, 422);
    const body = await readBoundedJson(request, 32 * 1024);
    if (!body.ok) return reply({ ok: false, code: "invalid" }, body.status);
    const parsed = inputSchema.safeParse(body.value);
    if (!parsed.success) return reply({ ok: false, code: "invalid" }, 422);
    const { accountId, ...command } = parsed.data;
    if (identity.value.actor.client !== "web" || identity.value.actor.userId !== accountId) return reply({ ok: false, code: "forbidden" }, 403);
    const configuration = translationConfiguration();
    if (!configuration) return reply({ ok: false, code: "disabled" }, 503);
    const session = await identity.value.client.auth.getSession();
    if (session.error) {
      const failure = authFailure(session.error);
      return reply(failure, failure.code === "unauthenticated" ? 401 : 503);
    }
    if (!session.data.session) return reply({ ok: false, code: "unauthenticated" }, 401);
    const result = await createCloudTranslationRunner({ ...identity.value,
      worker: createRemoteTranslationWorker(configuration, session.data.session.access_token, accountId),
      model: createPlanningModel(configuration.apiKey),
    }).run(command, request.signal);
    if (result.ok) return reply({ ok: true, runId: result.run.id, status: result.run.status }, 200);
    const statuses = { forbidden: 403, not_found: 404, invalid: 422, quota_exhausted: 429, busy: 409, unavailable: 503, cancelled: 409 };
    return reply(result, statuses[result.code]);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}
