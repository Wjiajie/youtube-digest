import { createVerifiedWorker, object, exact, uuid, integer, string, array, skill, usage, type RecordValue, type Environment, type ClientFactory } from "../_shared/verified-worker.ts";

type ClarificationRpc = "claim_goal_clarification" | "finish_goal_clarification";
const safeErrors: Record<string, string[]> = {
  "42501": ["CLARIFICATION_FORBIDDEN"], P0002: ["CLARIFICATION_NOT_FOUND"],
  "22023": ["CLARIFICATION_INVALID", "CLARIFICATION_REUSED", "CLARIFICATION_INVALID_SKILL", "CLARIFICATION_INVALID_RESULT", "CLARIFICATION_COMPLETION_REUSED", "CLARIFICATION_INVALID_STATE"],
  "40001": ["CLARIFICATION_VERSION_CONFLICT"], P0001: ["CLARIFICATION_BUSY", "CLARIFICATION_QUOTA_EXHAUSTED", "CLARIFICATION_WINDOW_FULL"],
};

// Node owns canonical result/domain validation; SQL owns captured source, Skill
// digest, lease and exact patch-merge invariants. Edge checks the transport envelope.
function result(value: unknown): value is RecordValue {
  if (!object(value) || typeof value.status !== "string" || typeof value.providerMayHaveRun !== "boolean" || !(value.usage === null || usage(value.usage))) return false;
  if (!["needs_input", "reviewable", "paused"].includes(value.status)) {
    return exact(value, ["status", "providerMayHaveRun", "usage"])
      && ["invalid_input", "unavailable", "invalid_output", "cancelled", "timed_out"].includes(value.status);
  }
  if (!exact(value, ["status", "providerMayHaveRun", "usage", "reflection", "changes", "question", "concerns", "pause", "content", "readiness", "skill", "source"])
    || value.providerMayHaveRun !== true || !usage(value.usage) || !string(value.reflection, 1000, 1)
    || !array(value.changes, 6, item => object(item) && exact(item, ["field", "value", "quote"]) && string(item.field, 64, 1)
      && (item.value === null || string(item.value, 4000) || typeof item.value === "number" && Number.isFinite(item.value)) && string(item.quote, 4000, 1))
    || !(value.question === null || object(value.question) && exact(value.question, ["field", "text"]) && string(value.question.field, 64, 1) && string(value.question.text, 1000, 1))
    || !array(value.concerns, 6, item => string(item, 500, 1))
    || !(value.pause === null || object(value.pause) && exact(value.pause, ["quote"]) && string(value.pause.quote, 4000, 1))
    || !object(value.content) || value.content.schemaVersion !== 1 || !object(value.readiness) || !exact(value.readiness, ["missing", "uncertainties"])
    || !array(value.readiness.missing, 6, item => string(item, 64, 1)) || !array(value.readiness.uncertainties, 6, item => string(item, 64, 1))
    || !skill(value.skill, "blueprint-clarify-goal") || !object(value.source)) return false;
  return exact(value.source, ["briefId", "briefRevision", "blueprintId", "turnId"])
    && uuid(value.source.briefId) && integer(value.source.briefRevision, 1) && uuid(value.source.blueprintId) && uuid(value.source.turnId);
}

/** Fixed clarification operations, independent credential, and a 1 MiB transport envelope. */
export function createClarificationWorker(env: Environment, createClient: ClientFactory<ClarificationRpc>) {
  return createVerifiedWorker(env, createClient, {
    bodyLimit: 1024 * 1024, errorPrefix: "CLARIFICATION", safeErrors,
    decodeOperation(payload) {
      if (!object(payload) || !uuid(payload.turnId) || !uuid(payload.leaseId)) return null;
      if (payload.operation === "claim" && exact(payload, ["operation", "turnId", "leaseId", "skill"]) && skill(payload.skill, "blueprint-clarify-goal")) {
        return { name: "claim_goal_clarification", args: { p_turn_id: payload.turnId, p_lease_id: payload.leaseId, p_skill: payload.skill } };
      }
      if (payload.operation === "finish" && exact(payload, ["operation", "turnId", "leaseId", "result"]) && result(payload.result)) {
        return { name: "finish_goal_clarification", args: { p_turn_id: payload.turnId, p_lease_id: payload.leaseId, p_result: payload.result } };
      }
      return null;
    },
  });
}
