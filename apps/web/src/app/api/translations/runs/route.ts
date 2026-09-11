import { z } from "zod";
import { authFailure, resolveRequestActor } from "@/lib/supabase/request";
import { readBoundedJson } from "@/lib/http/read-bounded-json";
import { startTranslationRunSchema, translationRunFailure } from "@/lib/agent/translation-run-access";
import { readTranslationRun } from "@/lib/agent/read-translation-run";
import { createCloudTranslationRunner } from "@/lib/agent/cloud-translation-runner";
import { createRemoteTranslationWorker, translationConfiguration } from "@/lib/agent/translation-runtime";
import { createPlanningModel } from "@/lib/agent/planning-runtime";
import { translationReply as reply, translationFailureReply } from "../response";

export const runtime = "nodejs";
export const maxDuration = 90;
const inputSchema = startTranslationRunSchema.extend({ accountId: z.uuid().transform(value => value.toLowerCase()) });
const lookupSchema = inputSchema.omit({ runId: true }).extend({
  offset: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(startTranslationRunSchema.shape.offset),
});

/** Locate this exact page in the caller's cloud history, then use the fresh verified projection. */
export async function GET(request: Request) {
  if (request.headers.has("authorization")) return reply({ ok: false, code: "forbidden" }, 403);
  try {
    const identity = await resolveRequestActor();
    if (!identity.ok) return reply(identity, identity.code === "unauthenticated" ? 401 : 503);
    const entries = [...new URL(request.url).searchParams.entries()];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return reply({ ok: false, code: "invalid" }, 422);
    const parsed = lookupSchema.safeParse(Object.fromEntries(entries));
    if (!parsed.success) return reply({ ok: false, code: "invalid" }, 422);
    const { accountId, ...command } = parsed.data;
    const { actor, client } = identity.value;
    if (actor.client !== "web" || actor.userId !== accountId) return reply({ ok: false, code: "forbidden" }, 403);
    const { data, error } = await client.rpc("find_translation_run", { p_request: command }).abortSignal(request.signal);
    if (error) return translationFailureReply(translationRunFailure(error));
    const { run_id: runId } = z.strictObject({ run_id: z.uuid().nullable() }).parse(data);
    if (!runId) return reply({ ok: true, run: null }, 200);
    const result = await readTranslationRun(client, actor, runId, request.signal);
    return result.ok ? reply(result, 200) : translationFailureReply(result);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}

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
    return translationFailureReply(result);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}
