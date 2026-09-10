import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@blueprint/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import type { ResourceProvider } from "../resources/types";
import { createResourceDiscovery } from "../resources/discovery";
import { resumeResourceCaptions } from "../resources/caption-resume";
import { createResourceMatcher } from "./resource-matcher";
import { loadResourceMatchingSkill } from "./resource-matching-skill";
import { parseResourceRun, resourceResultSchema, startResourceRunSchema, type ResourceCommand, type ResourceRun } from "./resource-run";
import { createResourceRunAccess, resourceRunFailure as failure, type ResourceRunResponse } from "./resource-run-access";
import type { ResourceFinish, ResourceWorker } from "./resource-worker";

function commandMatches(run: ResourceRun, command: ResourceCommand) {
  return run.kind === command.kind && (command.kind === "discover"
    ? run.nodeId === command.nodeId && run.blueprintVersion === command.expectedBlueprintVersion &&
      JSON.stringify(run.preferences) === JSON.stringify(command.preferences) && JSON.stringify(run.learnerContext) === JSON.stringify(command.learnerContext)
    : run.sourceRunId === command.sourceRunId);
}
/** Server orchestration; source and quotas come from the authenticated database, never caller evidence. */
export function createCloudResourceRunner(dependencies: { client: SupabaseClient; actor: Actor; worker: ResourceWorker; provider: ResourceProvider; model: Exclude<LanguageModel, string> }) {
  const actor = { ...dependencies.actor };
  const allowed = actor.client === "web" && z.uuid().safeParse(actor.userId).success;
  const { read, cancel } = createResourceRunAccess(dependencies.client, actor);
  async function finish(input: ResourceFinish): Promise<ResourceRunResponse> {
    try {
      const { data, error } = await dependencies.worker.finish(input);
      return error ? failure(error) : { ok: true, run: parseResourceRun(data, actor.userId, input.runId) };
    } catch { return { ok: false, code: "unavailable" }; }
  }
  async function execute(run: ResourceRun, signal: AbortSignal) {
    try {
      const input = { blueprint: run.blueprint, nodeId: run.nodeId, preferences: run.preferences, signal };
      const raw = run.kind === "discover" ? await createResourceDiscovery({ provider: dependencies.provider }).run(input)
        : run.kind === "captions" ? await resumeResourceCaptions({ discovery: run.discovery, preferences: run.preferences, signal }, dependencies.provider)
        : await createResourceMatcher({ model: dependencies.model }).run({ blueprint: run.blueprint, nodeId: run.nodeId, discovery: run.discovery,
          learnerContext: run.learnerContext, expectedSkillSha256: run.skill?.sha256, signal });
      // Bound stored evidence as well as the inputs of the next operation.
      if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 4 * 1024 * 1024) return { status: "invalid_output" as const };
      const parsed = resourceResultSchema.safeParse(raw);
      return parsed.success ? parsed.data : { status: "invalid_output" as const };
    } catch { return { status: signal.aborted ? "cancelled" as const : "unavailable" as const }; }
  }
  return { read, cancel, async run(input: unknown, signal: AbortSignal): Promise<ResourceRunResponse> {
    if (!allowed) return { ok: false, code: "forbidden" };
    const parsed = startResourceRunSchema.safeParse(input);
    if (!parsed.success || !(signal instanceof AbortSignal)) return { ok: false, code: "invalid" };
    if (signal.aborted) return { ok: false, code: "cancelled" };
    const command = parsed.data;
    try {
      const { data, error } = await dependencies.client.rpc("begin_resource_run", { p_request: command });
      if (error) return failure(error);
      const started = parseResourceRun(data, actor.userId, command.runId);
      if (!commandMatches(started, command)) return { ok: false, code: "unavailable" };
      if (started.status !== "queued") return { ok: true, run: started };
      if (signal.aborted) return cancel(started.id);
      if (Buffer.byteLength(JSON.stringify({ blueprint: started.blueprint, discovery: started.discovery }), "utf8") > 4 * 1024 * 1024) {
        const cancelled = await cancel(started.id);
        return cancelled.ok && cancelled.run.status === "cancelled" ? { ok: false, code: "input_too_large" } : cancelled;
      }
      const loaded = started.kind === "match" ? await loadResourceMatchingSkill() : null;
      if (signal.aborted) return cancel(started.id);
      const skill = loaded ? { ...loaded.identity, instructions: loaded.instructions } : null;
      const leaseId = randomUUID();
      const claimed = await dependencies.worker.claim({ runId: started.id, leaseId, skill });
      if (claimed.error) return failure(claimed.error);
      const receipt = z.strictObject({ acquired: z.boolean(), run: z.unknown() }).parse(claimed.data);
      const current = parseResourceRun(receipt.run, actor.userId, started.id);
      if (!receipt.acquired) return { ok: true, run: current };
      if (current.status !== "running" || !commandMatches(current, command) || JSON.stringify(current.skill) !== JSON.stringify(skill)) return { ok: false, code: "unavailable" };
      const result = await execute(current, signal);
      const args = { runId: current.id, leaseId, result };
      const finished = await finish(args);
      // Only the identical storage receipt can retry; not discovery, jobs, model or claim.
      return !finished.ok && finished.code === "unavailable" ? finish(args) : finished;
    } catch { return { ok: false, code: "unavailable" }; }
  } };
}
