import { z } from "zod";
import { authFailure, resolveRequestActor } from "@/lib/supabase/request";
import { startResourceRunSchema } from "@/lib/agent/resource-run";
import { createCloudResourceRunner } from "@/lib/agent/cloud-resource-runner";
import { resourceConfiguration, createResourceWorker } from "@/lib/agent/resource-runtime";
import { createPlanningModel } from "@/lib/agent/planning-runtime";
import { createResourceProvider } from "@/lib/resources/provider";
import { resourceAdoptionCommandSchema } from "@/lib/agent/resource-adoption";
import { resourceAdoptionConfiguration, createResourceAdoptionWorker } from "@/lib/agent/resource-adoption-runtime";
import { createCloudResourceAdoption } from "@/lib/agent/cloud-resource-adoption";
import { createVideoVerification } from "@/lib/resources/verification";

export const runtime = "nodejs";
export const maxDuration = 90;
const inputSchema = z.discriminatedUnion("kind", [startResourceRunSchema.options[0].extend({ accountId: z.uuid() }),
  startResourceRunSchema.options[1].extend({ accountId: z.uuid() }), resourceAdoptionCommandSchema.extend({ kind: z.literal("adopt"), accountId: z.uuid() })]);
const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Explicit execution only. Recovery and cancellation remain separate from this long request. */
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
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DOMException("Read deadline", "TimeoutError")), 5000); });
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 32 * 1024) { void reader.cancel().catch(() => {}); return reply({ ok: false, code: "invalid" }, 413); }
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
    const configuration = command.kind === "adopt" ? null : resourceConfiguration();
    const adoptionConfig = command.kind === "adopt" ? resourceAdoptionConfiguration() : null;
    if (!configuration && !adoptionConfig) return reply({ ok: false, code: "disabled" }, 503);
    const session = await identity.value.client.auth.getSession();
    if (session.error) {
      const failure = authFailure(session.error);
      return reply(failure, failure.code === "unauthenticated" ? 401 : 503);
    }
    if (!session.data.session) return reply({ ok: false, code: "unauthenticated" }, 401);
    const statuses = { forbidden: 403, invalid: 422, not_found: 404, version_conflict: 409, quota_exhausted: 429,
      busy: 409, unavailable: 503, cancelled: 409, input_too_large: 413 };
    if (command.kind === "adopt" && adoptionConfig) {
      const { kind: _kind, ...adoption } = command;
      const result = await createCloudResourceAdoption({ ...identity.value,
        worker: createResourceAdoptionWorker(adoptionConfig, session.data.session.access_token),
        verification: createVideoVerification({ youtubeApiKey: adoptionConfig.youtubeApiKey }),
      }).run(adoption, request.signal);
      return result.ok ? reply({ ok: true, adoptionId: result.adoption.id, status: result.adoption.status }, 200) : reply(result, statuses[result.code]);
    }
    if (command.kind === "adopt" || !configuration) return reply({ ok: false, code: "disabled" }, 503);
    // Edge verifies the forwarded token itself; the browser cannot choose an owner or RPC.
    const result = await createCloudResourceRunner({ ...identity.value,
      worker: createResourceWorker(configuration, session.data.session.access_token), model: createPlanningModel(configuration.apiKey),
      provider: createResourceProvider({ youtubeApiKey: configuration.youtubeApiKey, supadataApiKey: configuration.supadataApiKey }),
    }).run(command, request.signal);
    if (result.ok) return reply({ ok: true, runId: result.run.id, status: result.run.status }, 200);
    return reply(result, statuses[result.code]);
  } catch { return reply({ ok: false, code: "unavailable" }, 503); }
}
