import {
  createVerifiedWorker, object, exact, uuid, skill, string, integer, usage,
  type Environment, type ClientFactory,
} from "../_shared/verified-worker.ts";

type TranslationRpc = "claim_translation_run" | "finish_translation_run";

function result(value: unknown): boolean {
  if (!object(value) || (value.usage !== null && !usage(value.usage))) return false;
  if (value.status !== "translated") return exact(value, ["status", "providerMayHaveRun", "usage"])
    && typeof value.status === "string" && ["invalid_input", "no_evidence", "unavailable", "cancelled", "timed_out", "invalid_output", "expired"].includes(value.status)
    && typeof value.providerMayHaveRun === "boolean";
  if (!exact(value, ["status", "segments", "providerMayHaveRun", "usage"]) || value.providerMayHaveRun !== true
    || !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 20) return false;
  let previous: number | undefined;
  for (const segment of value.segments) {
    if (!object(segment) || !exact(segment, ["segmentIndex", "translation"]) || !integer(segment.segmentIndex, 0, 19999)
      || (previous !== undefined && segment.segmentIndex !== previous + 1)
      || !string(segment.translation, 20000, 1) || !segment.translation.trim()) return false;
    previous = segment.segmentIndex;
  }
  return true;
}

export function createTranslationWorker(env: Environment & { extensionClientId?: string }, createClient: ClientFactory<TranslationRpc>, forbiddenSecrets: readonly string[] = []) {
  const reused = forbiddenSecrets.some(value => value.trim().length > 0 && value.trim() === env.workerSecret);
  return createVerifiedWorker({ ...env, workerSecret: reused ? "" : env.workerSecret }, createClient, {
    bodyLimit: 2 * 1024 * 1024,
    errorPrefix: "TRANSLATION",
    allowedOAuthClientId: env.extensionClientId,
    safeErrors: {
      "42501": ["TRANSLATION_FORBIDDEN", "TRANSLATION_LEASE_INVALID"],
      P0002: ["TRANSLATION_NOT_FOUND"],
      "22023": ["TRANSLATION_INVALID", "TRANSLATION_INVALID_RESULT", "TRANSLATION_COMPLETION_REUSED", "TRANSLATION_SOURCE_IMMUTABLE"],
    },
    decodeOperation(payload) {
      if (!object(payload) || !uuid(payload.runId) || !uuid(payload.leaseId)) return null;
      if (payload.operation === "claim" && exact(payload, ["operation", "runId", "leaseId", "skill", "model"])
        && skill(payload.skill, "blueprint-translate-transcript") && payload.skill.version === "1.0.0"
        && typeof payload.skill.instructions === "string" && new TextEncoder().encode(payload.skill.instructions).byteLength <= 65536
        && string(payload.model, 200, 1) && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(payload.model)) {
        return { name: "claim_translation_run", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_skill: payload.skill, p_model: payload.model } };
      }
      if (payload.operation === "finish" && exact(payload, ["operation", "runId", "leaseId", "result"]) && result(payload.result)) {
        return { name: "finish_translation_run", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_result: payload.result } };
      }
      return null;
    },
  });
}
