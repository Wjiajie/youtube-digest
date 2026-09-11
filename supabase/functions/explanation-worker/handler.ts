import {
  createVerifiedWorker, object, exact, uuid, skill, string, integer, array, usage,
  type Environment, type ClientFactory,
} from "../_shared/verified-worker.ts";

type ExplanationRpc = "claim_explanation_run" | "finish_explanation_run";

const prose = (value: unknown, max: number) => string(value, max, 1) && value.trim().length > 0
  && value.isWellFormed() && !value.includes("\0");

function result(value: unknown): boolean {
  if (!object(value) || (value.usage !== null && !usage(value.usage))) return false;
  if (value.status !== "explained" && value.status !== "insufficient_context") return exact(value, ["status", "providerMayHaveRun", "usage"])
    && typeof value.status === "string" && ["invalid_input", "no_evidence", "unavailable", "cancelled", "timed_out", "invalid_output", "expired"].includes(value.status)
    && typeof value.providerMayHaveRun === "boolean";
  if (!exact(value, ["status", "answer", "providerMayHaveRun", "usage"]) || value.providerMayHaveRun !== true || !object(value.answer)) return false;
  const answer = value.answer;
  if (value.status === "insufficient_context") return exact(answer, ["kind", "reason", "missingContext"])
    && answer.kind === "insufficient_context" && prose(answer.reason, 1000) && array(answer.missingContext, 3, item => prose(item, 500), 1);
  if (value.status !== "explained" || !exact(answer, ["kind", "meaning", "reasoning", "background", "checkQuestion", "limitations", "evidence"])
    || answer.kind !== "explanation" || !prose(answer.meaning, 2000) || !prose(answer.reasoning, 3000)
    || (answer.background !== null && !prose(answer.background, 2000)) || (answer.checkQuestion !== null && !prose(answer.checkQuestion, 500))
    || !array(answer.limitations, 3, item => prose(item, 500)) || !Array.isArray(answer.evidence) || answer.evidence.length < 1 || answer.evidence.length > 3) return false;
  const seen = new Set<string>();
  for (const evidence of answer.evidence) {
    if (!object(evidence) || !exact(evidence, ["segmentIndex", "quote"]) || !integer(evidence.segmentIndex, 0, 19999) || !prose(evidence.quote, 300)) return false;
    const key = JSON.stringify([evidence.segmentIndex, evidence.quote]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  // The database, not this transport, verifies quotes against the immutable source selection.
  return true;
}

export function createExplanationWorker(env: Environment & { extensionClientId?: string }, createClient: ClientFactory<ExplanationRpc>, forbiddenSecrets: readonly string[] = []) {
  const reused = forbiddenSecrets.some(value => value.trim().length > 0 && value.trim() === env.workerSecret);
  return createVerifiedWorker({ ...env, workerSecret: reused ? "" : env.workerSecret }, createClient, {
    bodyLimit: 128 * 1024,
    errorPrefix: "EXPLANATION",
    allowedOAuthClientId: env.extensionClientId,
    safeErrors: {
      "42501": ["EXPLANATION_FORBIDDEN", "EXPLANATION_LEASE_INVALID"],
      P0002: ["EXPLANATION_NOT_FOUND"],
      "22023": ["EXPLANATION_INVALID", "EXPLANATION_INVALID_RESULT", "EXPLANATION_COMPLETION_REUSED", "EXPLANATION_SOURCE_IMMUTABLE"],
    },
    decodeOperation(payload) {
      if (!object(payload) || !uuid(payload.runId) || !uuid(payload.leaseId)) return null;
      if (payload.operation === "claim" && exact(payload, ["operation", "runId", "leaseId", "skill", "model"])
        && skill(payload.skill, "blueprint-explain-selection") && payload.skill.version === "1.0.0"
        && typeof payload.skill.instructions === "string" && new TextEncoder().encode(payload.skill.instructions).byteLength <= 65536
        && string(payload.model, 200, 1) && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(payload.model)) {
        return { name: "claim_explanation_run", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_skill: payload.skill, p_model: payload.model } };
      }
      if (payload.operation === "finish" && exact(payload, ["operation", "runId", "leaseId", "result"]) && result(payload.result)) {
        return { name: "finish_explanation_run", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_result: payload.result } };
      }
      return null;
    },
  });
}
