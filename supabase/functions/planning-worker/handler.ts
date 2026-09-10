import { createVerifiedWorker, object, exact, uuid, integer, string, array, skill, usage, type RecordValue, type Environment, type ClientFactory } from "../_shared/verified-worker.ts";

type PlanningRpc = "claim_path_planning" | "finish_path_planning";
// The Node planner owns canonical domain validation; SQL owns captured source and
// lease invariants. This boundary validates the bounded result envelope, not a second domain model.
function result(value: unknown): value is RecordValue {
  if (!object(value) || typeof value.status !== "string" || typeof value.providerMayHaveRun !== "boolean" || !(value.usage === null || usage(value.usage))) return false;
  if (value.status !== "ready") return exact(value, ["status", "providerMayHaveRun", "usage"])
    && ["invalid_input", "needs_confirmation", "unavailable", "invalid_output", "cancelled", "timed_out"].includes(value.status);
  if (!exact(value, ["status", "providerMayHaveRun", "usage", "draft", "schedule", "assumptions", "skill", "source"])
    || value.providerMayHaveRun !== true || !usage(value.usage) || !object(value.draft) || value.draft.schemaVersion !== 2
    || !array(value.draft.goals, 12, object, 1) || !skill(value.skill, "blueprint-plan-path")
    || !array(value.schedule, 128, item => object(item) && exact(item, ["nodeId", "week"]) && uuid(item.nodeId) && integer(item.week, 1, 26), 1)
    || !array(value.assumptions, 8, item => string(item, 500)) || !object(value.source)) return false;
  const source = value.source;
  return exact(source, ["runId", "briefId", "briefRevision", "blueprintId", "blueprintVersion", "startDate"])
    && uuid(source.runId) && uuid(source.briefId) && uuid(source.blueprintId) && integer(source.briefRevision, 1)
    && integer(source.blueprintVersion, 0) && typeof source.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.startDate)
    && Number.isFinite(Date.parse(`${source.startDate}T00:00:00Z`)) && new Date(`${source.startDate}T00:00:00Z`).toISOString().slice(0, 10) === source.startDate;
}
const safeErrors: Record<string, string[]> = {
  "42501": ["PATH_PLANNING_FORBIDDEN"], P0002: ["PATH_PLANNING_NOT_FOUND"],
  "22023": ["PATH_PLANNING_INVALID", "PATH_PLANNING_INVALID_SKILL", "PATH_PLANNING_INVALID_RESULT", "PATH_PLANNING_COMPLETION_REUSED", "PATH_PLANNING_INVALID_STATE"],
  "40001": ["PATH_PLANNING_VERSION_CONFLICT"], P0001: ["PATH_PLANNING_BUSY", "PATH_PLANNING_QUOTA_EXHAUSTED"],
};

/** Fixed planning operations only; shared transport policy never accepts a client-selected RPC or owner. */
export function createPlanningWorker(env: Environment, createClient: ClientFactory<PlanningRpc>) {
  return createVerifiedWorker(env, createClient, {
    bodyLimit: 8 * 1024 * 1024, errorPrefix: "PATH_PLANNING", safeErrors,
    decodeOperation(payload) {
      if (!object(payload) || !uuid(payload.runId) || !uuid(payload.leaseId)) return null;
      if (payload.operation === "claim" && exact(payload, ["operation", "runId", "leaseId", "skill"]) && skill(payload.skill, "blueprint-plan-path")) {
        return { name: "claim_path_planning", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_skill: payload.skill } };
      }
      if (payload.operation === "finish" && exact(payload, ["operation", "runId", "leaseId", "result"]) && result(payload.result)) {
        return { name: "finish_path_planning", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_result: payload.result } };
      }
      return null;
    },
  });
}
