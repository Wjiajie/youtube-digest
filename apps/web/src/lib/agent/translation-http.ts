import { NextRequest } from "next/server";
import { z } from "zod";
import { authFailure, resolveExtensionRequestActor, resolveRequestActor } from "../supabase/request";
import { createTranslationRunAccess, startTranslationRunSchema, translationRunFailure } from "./translation-run-access";
import { readTranslationRun } from "./read-translation-run";
import { readBoundedJson } from "../http/read-bounded-json";
import { createCloudTranslationRunner } from "./cloud-translation-runner";
import { createRemoteTranslationWorker, translationConfiguration } from "./translation-runtime";
import { createPlanningModel } from "./planning-runtime";
import { translationReply as reply, translationFailureReply } from "@/app/api/translations/response";

type Transport = "web" | "extension";
type Context = { params: Promise<{ runId: string }> };
const id = z.uuid().transform(value => value.toLowerCase());
const cancellation = z.strictObject({ operation: z.literal("cancel"), accountId: id });
const inputSchema = startTranslationRunSchema.extend({ accountId: id });
const lookupSchema = inputSchema.omit({ runId: true }).extend({
  offset: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(startTranslationRunSchema.shape.offset),
});

function transportFailure(request: Request, transport: Transport, write = false) {
  if (transport === "extension") {
    // Check before calling the shared resolver: it must never fall back to cookies.
    if (!/^Bearer \S+$/.test(request.headers.get("authorization") ?? "")) return reply({ ok: false, code: "unauthenticated" }, 401);
  } else {
    const origin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
    if (request.headers.has("authorization") || write && request.headers.get("origin") !== origin)
      return reply({ ok: false, code: "forbidden" }, 403);
  }
}
function webCredentialFailure(token: string, accountId: string) {
  // Classification only, after Auth verifies the user. JWT decoding never verifies a caller.
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Invalid token");
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims) || !("sub" in claims) || claims.sub !== accountId)
      throw new Error("Invalid account");
    if (Object.hasOwn(claims, "client_id")) return { ok: false as const, code: "forbidden" as const };
  } catch { return { ok: false as const, code: "unauthenticated" as const }; }
}
async function identityFor(request: Request, transport: Transport) {
  if (transport === "extension") return resolveExtensionRequestActor(new NextRequest(request.url, { headers: request.headers }));
  const identity = await resolveRequestActor();
  if (!identity.ok) return identity;
  const session = await identity.value.client.auth.getSession();
  if (session.error) return authFailure(session.error);
  if (!session.data.session || session.data.session.user.id !== identity.value.actor.userId) return { ok: false as const, code: "unauthenticated" as const };
  return webCredentialFailure(session.data.session.access_token, identity.value.actor.userId) ?? identity;
}
const identityFailureReply = (failure: { ok: false; code: "unauthenticated" | "unavailable" | "forbidden" }) =>
  reply(failure, { unauthenticated: 401, unavailable: 503, forbidden: 403 }[failure.code]);

/** Both transports share exact-page lookup and the same fresh browser projection. */
export function createTranslationHttpHandlers(transport: Transport) {
  return {
    async start(request: Request) {
      const denied = transportFailure(request, transport, true); if (denied) return denied;
      try {
        const identity = await identityFor(request, transport);
        if (!identity.ok) return identityFailureReply(identity);
        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ ok: false, code: "invalid" }, 422);
        const body = await readBoundedJson(request, 32 * 1024);
        if (!body.ok) return reply({ ok: false, code: "invalid" }, body.status);
        const parsed = inputSchema.safeParse(body.value);
        if (!parsed.success) return reply({ ok: false, code: "invalid" }, 422);
        const { accountId, ...command } = parsed.data;
        if (identity.value.actor.client !== transport || identity.value.actor.userId !== accountId) return reply({ ok: false, code: "forbidden" }, 403);
        const configuration = translationConfiguration();
        if (!configuration) return reply({ ok: false, code: "disabled" }, 503);
        let accessToken: string;
        if (transport === "extension") {
          // Auth has verified this exact token above. Never refresh it from a Web Cookie session.
          accessToken = request.headers.get("authorization")!.slice("Bearer ".length);
        } else {
          const session = await identity.value.client.auth.getSession();
          if (session.error) {
            const failure = authFailure(session.error);
            return reply(failure, failure.code === "unauthenticated" ? 401 : 503);
          }
          if (!session.data.session) return reply({ ok: false, code: "unauthenticated" }, 401);
          accessToken = session.data.session.access_token;
          const invalid = session.data.session.user.id !== accountId ? { ok: false as const, code: "unauthenticated" as const }
            : webCredentialFailure(accessToken, accountId);
          if (invalid) return identityFailureReply(invalid);
        }
        const result = await createCloudTranslationRunner({ ...identity.value,
          worker: createRemoteTranslationWorker(configuration, accessToken, accountId),
          model: createPlanningModel(configuration.apiKey),
        }).run(command, request.signal);
        return result.ok ? reply({ ok: true, runId: result.run.id, status: result.run.status }, 200) : translationFailureReply(result);
      } catch { return reply({ ok: false, code: "unavailable" }, 503); }
    },
    async read(request: Request, context: Context) {
      const denied = transportFailure(request, transport); if (denied) return denied;
      try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
        const identity = await identityFor(request, transport);
        if (!identity.ok) return identityFailureReply(identity);
        const query = [...new URL(request.url).searchParams.entries()];
        const accountId = id.safeParse(query.length === 1 && query[0][0] === "accountId" ? query[0][1] : null);
        const runId = id.safeParse((await context.params).runId);
        if (!accountId.success || !runId.success) return reply({ ok: false, code: "invalid" }, 422);
        if (identity.value.actor.client !== transport || identity.value.actor.userId !== accountId.data) return reply({ ok: false, code: "forbidden" }, 403);
        signal.throwIfAborted();
        const result = await readTranslationRun(identity.value.client, identity.value.actor, runId.data, signal);
        return result.ok ? reply(result, 200) : translationFailureReply(result);
      } catch { return reply({ ok: false, code: "unavailable" }, 503); }
    },
    async cancel(request: Request, context: Context) {
      const denied = transportFailure(request, transport, true); if (denied) return denied;
      try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
        const identity = await identityFor(request, transport);
        if (!identity.ok) return identityFailureReply(identity);
        if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ ok: false, code: "invalid" }, 422);
        const body = await readBoundedJson(request, 32 * 1024);
        if (!body.ok) return reply({ ok: false, code: "invalid" }, body.status);
        const command = cancellation.safeParse(body.value), runId = id.safeParse((await context.params).runId);
        if (!command.success || !runId.success) return reply({ ok: false, code: "invalid" }, 422);
        if (identity.value.actor.client !== transport || identity.value.actor.userId !== command.data.accountId) return reply({ ok: false, code: "forbidden" }, 403);
        signal.throwIfAborted();
        const result = await createTranslationRunAccess(identity.value.client, identity.value.actor).cancel(runId.data, signal);
        return result.ok ? reply({ ok: true, runId: result.run.id, status: result.run.status }, 200) : translationFailureReply(result);
      } catch { return reply({ ok: false, code: "unavailable" }, 503); }
    },
    async find(request: Request) {
      const denied = transportFailure(request, transport); if (denied) return denied;
      try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
        const identity = await identityFor(request, transport);
        if (!identity.ok) return identityFailureReply(identity);
        const entries = [...new URL(request.url).searchParams.entries()];
        if (new Set(entries.map(([key]) => key)).size !== entries.length) return reply({ ok: false, code: "invalid" }, 422);
        const parsed = lookupSchema.safeParse(Object.fromEntries(entries));
        if (!parsed.success) return reply({ ok: false, code: "invalid" }, 422);
        const { accountId, ...command } = parsed.data;
        const { actor, client } = identity.value;
        if (actor.client !== transport || actor.userId !== accountId) return reply({ ok: false, code: "forbidden" }, 403);
        signal.throwIfAborted();
        const { data, error } = await client.rpc("find_translation_run", { p_request: command }).abortSignal(signal);
        if (error) return translationFailureReply(translationRunFailure(error));
        const { run_id: runId } = z.strictObject({ run_id: z.uuid().nullable() }).parse(data);
        if (!runId) return reply({ ok: true, run: null }, 200);
        const result = await readTranslationRun(client, actor, runId, signal);
        return result.ok ? reply(result, 200) : translationFailureReply(result);
      } catch { return reply({ ok: false, code: "unavailable" }, 503); }
    },
  };
}
