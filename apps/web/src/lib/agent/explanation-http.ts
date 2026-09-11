import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { readBoundedJson } from "../http/read-bounded-json";
import { createExplanationRunAccess, startExplanationRunSchema } from "./explanation-run-access";
import { readExplanationRun } from "./read-explanation-run";
import { explanationIdentity, explanationTransportFailure, type ExplanationTransport } from "./explanation-http-identity";
import { createCloudExplanationRunner } from "./cloud-explanation-runner";
import { createRemoteExplanationWorker, explanationConfiguration } from "./explanation-runtime";
import { createPlanningModel } from "./planning-runtime";

type Context = { params: Promise<{ runId: string }> };
const id = z.uuid().transform(value => value.toLowerCase());
const inputSchema = startExplanationRunSchema.extend({ accountId: id,
  question: startExplanationRunSchema.shape.question.refine(value => value.isWellFormed() && !value.includes("\0")),
});
const lookupSchema = inputSchema.omit({ runId: true });
const cancellation = z.strictObject({ operation: z.literal("cancel"), accountId: id });
const statuses = { unauthenticated: 401, forbidden: 403, not_found: 404, invalid: 422, quota_exhausted: 429,
  busy: 409, unavailable: 503, cancelled: 409, disabled: 503 };
const reply = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
const fail = (code: keyof typeof statuses, status = statuses[code]) => reply({ ok: false, code }, status);
const budget = (request: Request) => AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);

async function bodyFor(request: Request, signal: AbortSignal) {
  if (new URL(request.url).searchParams.size || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return { ok: false as const, status: 422 as const };
  // Read the original Next body. Copying Request introduces a second stream
  // teardown path when the upload is rejected or cancelled.
  const body = await readBoundedJson(request, 32 * 1024, signal);
  signal.throwIfAborted();
  return body;
}

/** Both transports expose only explicit execution acknowledgements and fresh,
 * source-gated projections. A private question is never a URL parameter. */
export function createExplanationHttpHandlers(transport: ExplanationTransport) {
  return {
    async start(request: Request) {
      const denied = explanationTransportFailure(request, transport, true); if (denied) return fail(denied.code);
      try {
        const identity = await explanationIdentity(request, transport, budget(request));
        if (!identity.ok) return fail(identity.code);
        const body = await bodyFor(request, request.signal);
        if (!body.ok) return fail("invalid", body.status);
        const parsed = inputSchema.safeParse(body.value);
        if (!parsed.success) return fail("invalid");
        const { accountId, ...command } = parsed.data;
        const { actor, client, accessToken } = identity.value;
        if (actor.userId !== accountId) return fail("forbidden");
        const configuration = explanationConfiguration();
        if (!configuration) return fail("disabled");
        const result = await createCloudExplanationRunner({ actor, client,
          worker: createRemoteExplanationWorker(configuration, accessToken, accountId), model: createPlanningModel(configuration.apiKey),
        }).run(command, request.signal);
        return result.ok ? reply({ ok: true, runId: result.run.id, status: result.run.status }) : fail(result.code);
      } catch { return fail("unavailable"); }
    },
    async read(request: Request, context: Context) {
      const denied = explanationTransportFailure(request, transport, false); if (denied) return fail(denied.code);
      try {
        const signal = budget(request), identity = await explanationIdentity(request, transport, signal);
        if (!identity.ok) return fail(identity.code);
        const query = [...new URL(request.url).searchParams.entries()];
        const accountId = id.safeParse(query.length === 1 && query[0][0] === "accountId" ? query[0][1] : null);
        const runId = id.safeParse((await context.params).runId);
        if (!accountId.success || !runId.success) return fail("invalid");
        const { actor, client } = identity.value;
        if (actor.userId !== accountId.data) return fail("forbidden");
        const result = await readExplanationRun(client, actor, runId.data, signal);
        signal.throwIfAborted();
        return result.ok ? reply(result) : fail(result.code);
      } catch { return fail("unavailable"); }
    },
    async cancel(request: Request, context: Context) {
      const denied = explanationTransportFailure(request, transport, true); if (denied) return fail(denied.code);
      try {
        const signal = budget(request), identity = await explanationIdentity(request, transport, signal);
        if (!identity.ok) return fail(identity.code);
        const body = await bodyFor(request, signal);
        if (!body.ok) return fail("invalid", body.status);
        const command = cancellation.safeParse(body.value), runId = id.safeParse((await context.params).runId);
        if (!command.success || !runId.success) return fail("invalid");
        const { actor, client } = identity.value;
        if (actor.userId !== command.data.accountId) return fail("forbidden");
        const result = await createExplanationRunAccess(client, actor).cancel(runId.data, signal);
        signal.throwIfAborted();
        return result.ok ? reply({ ok: true, runId: result.run.id, status: result.run.status }) : fail(result.code);
      } catch { return fail("unavailable"); }
    },
    async find(request: Request) {
      const denied = explanationTransportFailure(request, transport, true); if (denied) return fail(denied.code);
      try {
        const signal = budget(request), identity = await explanationIdentity(request, transport, signal);
        if (!identity.ok) return fail(identity.code);
        const body = await bodyFor(request, signal);
        if (!body.ok) return fail("invalid", body.status);
        const parsed = lookupSchema.safeParse(body.value);
        if (!parsed.success) return fail("invalid");
        const { accountId, ...command } = parsed.data, { actor, client } = identity.value;
        if (actor.userId !== accountId) return fail("forbidden");
        const found = await createExplanationRunAccess(client, actor).find(command, signal);
        signal.throwIfAborted();
        if (!found.ok) return fail(found.code);
        if (!found.runId) return reply({ ok: true, run: null });
        const result = await readExplanationRun(client, actor, found.runId, signal);
        signal.throwIfAborted();
        if (!result.ok) return fail(result.code);
        const run = result.run;
        if (run.context.bindingId !== command.bindingId || run.context.videoId !== command.videoId || run.context.sourceRunId !== command.sourceRunId
          || run.context.offset !== command.offset || run.targetLanguage !== command.targetLanguage
          || run.status !== "cleared" && (run.question !== command.question || !isDeepStrictEqual(run.selection, command.selection))) return fail("unavailable");
        return reply(result);
      } catch { return fail("unavailable"); }
    },
  };
}
