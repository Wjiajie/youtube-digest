import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResourceRunAccess } from "./resource-run-access";
import { createResourceAdoptionAccess, adoptionFailure, type ResourceAdoptionResponse } from "./resource-adoption-access";
import { parseResourceAdoption, resourceAdoptionCommandSchema, type ResourceAdoptionWorker, type ResourceAdoption, type ResourceAdoptionCommand } from "./resource-adoption";
import { videoVerificationSchema, type createVideoVerification } from "../resources/verification";
import { resourceExecutionSignal } from "./resource-lifetime";

function matches(record: ResourceAdoption, command: ResourceAdoptionCommand) {
  return record.id === command.adoptionId && record.sourceRunId === command.sourceRunId &&
    (record.status === "cleared" || record.videoId === command.videoId) && record.replaceBindingId === command.replaceBindingId;
}
/** One provider lookup after one lease claim; verification only prepares a proposal, never applies it. */
export function createCloudResourceAdoption(dependencies: { client: SupabaseClient; actor: Actor; worker: ResourceAdoptionWorker; verification: ReturnType<typeof createVideoVerification> }) {
  const actor = { ...dependencies.actor }, access = createResourceAdoptionAccess(dependencies.client, actor);
  async function finish(input: Parameters<ResourceAdoptionWorker["finish"]>[0]): Promise<ResourceAdoptionResponse> {
    try {
      const { data, error } = await dependencies.worker.finish(input);
      return error ? adoptionFailure(error) : { ok: true, adoption: parseResourceAdoption(data, actor.userId, input.adoptionId) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  return { ...access, async run(input: unknown, signal: AbortSignal): Promise<ResourceAdoptionResponse> {
    if (actor.client !== "web" || !z.uuid().safeParse(actor.userId).success) return { ok: false, code: "forbidden" };
    const parsed = resourceAdoptionCommandSchema.safeParse(input);
    if (!parsed.success || !(signal instanceof AbortSignal)) return { ok: false, code: "invalid" };
    if (signal.aborted) return { ok: false, code: "cancelled" };
    const command = parsed.data;
    try {
      const { data, error } = await dependencies.client.rpc("begin_resource_adoption", { p_request: command });
      if (error) return adoptionFailure(error);
      const started = parseResourceAdoption(data, actor.userId, command.adoptionId);
      if (!matches(started, command)) return { ok: false, code: "unavailable" };
      if (started.status !== "queued") return { ok: true, adoption: started };
      if (signal.aborted) return access.cancel(started.id);
      const source = await createResourceRunAccess(dependencies.client, actor).read(started.sourceRunId);
      if (!source.ok) { await access.cancel(started.id); return source; }
      const run = source.run;
      const candidate = run.discovery?.candidates.find(item => item.video.videoId === started.videoId && item.eligibleForMatching && item.transcript.status === "ready");
      const assessment = run.result?.status === "matched" ? run.result.assessments.find(item => item.videoId === started.videoId && item.role !== "rejected") : null;
      if (run.status !== "ready" || !candidate || !assessment || run.blueprintId !== started.blueprintId || run.blueprintVersion !== started.blueprintVersion || run.nodeId !== started.nodeId) {
        await access.cancel(started.id); return { ok: false, code: "version_conflict" };
      }
      if (signal.aborted) return access.cancel(started.id);
      const leaseId = randomUUID();
      const claimStartedAt = performance.now();
      const claim = await dependencies.worker.claim({ adoptionId: started.id, leaseId });
      if (claim.error) return adoptionFailure(claim.error);
      const receipt = z.strictObject({ acquired: z.boolean(), adoption: z.unknown(), observed_at: z.iso.datetime({ offset: true }) }).parse(claim.data);
      const current = parseResourceAdoption(receipt.adoption, actor.userId, started.id);
      if (!receipt.acquired) return { ok: true, adoption: current };
      if (current.status !== "running" || !matches(current, command)) return { ok: false, code: "unavailable" };
      const executionSignal = resourceExecutionSignal(current, receipt.observed_at, claimStartedAt, signal);
      const raw = executionSignal.aborted ? { status: signal.aborted ? "cancelled" as const : "timed_out" as const }
        : await dependencies.verification.run({ original: candidate.video, preferences: run.preferences, signal: executionSignal });
      const parsedResult = videoVerificationSchema.parse(raw);
      const result = parsedResult.status === "cancelled" && executionSignal.aborted && !signal.aborted
        ? { status: "timed_out" as const } : parsedResult;
      const args = { adoptionId: current.id, leaseId, result };
      const saved = await finish(args);
      // Retry only the exact storage receipt, never the provider lookup or lease claim.
      return !saved.ok && saved.code === "unavailable" ? finish(args) : saved;
    } catch { return { ok: false, code: "unavailable" }; }
  } };
}
