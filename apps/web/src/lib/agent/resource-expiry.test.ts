import { expect, it } from "vitest";
import { parseResourceRun } from "./resource-run";
import { parseResourceAdoption } from "./resource-adoption";

const id = "10000000-0000-4000-8000-000000000001";
const start = "2026-09-11T01:00:00Z", end = "2026-09-11T02:00:00Z";
const lifetime = { source_started_at: start, content_expires_at: end, retention_policy_ref: "local-fixture-v1", clear_reason: null };
const receipt = { id, owner_id: id, blueprint_id: id, blueprint_version: 1, node_id: id, created_at: start, expires_at: start, cleared_at: end };
const run = { ...receipt, ...lifetime, kind: "discover", source_run_id: null, status: "cleared", clear_reason: "expired",
  preferences: null, learner_context: null, input_blueprint: null, input_discovery: null, skill: null, result: null };
const adoption = { ...receipt, ...lifetime, source_run_id: id, status: "cleared", clear_reason: "expired", video_id: null,
  replace_binding_id: null, new_binding_id: id, verified_at: null, valid_until: null, proposal_id: null, result: null };

it("reads expiry as a reasoned, body-free receipt distinct from execution timeout and manual clearing", () => {
  for (const record of [parseResourceRun(run, id, id), parseResourceAdoption(adoption, id, id)]) {
    expect(record).toMatchObject({ status: "cleared", clearReason: "expired", sourceStartedAt: start, contentExpiresAt: end, retentionPolicyRef: "local-fixture-v1", result: null });
  }
});
it("rejects incomplete or extended-looking chronology instead of accepting a forged expiry receipt", () => {
  for (const change of [{ source_started_at: null }, { retention_policy_ref: null }, { content_expires_at: start },
    { cleared_at: start }, { clear_reason: "unknown" }, { retention_policy_ref: "" }]) {
    expect(() => parseResourceRun({ ...run, ...change }, id, id)).toThrow();
    expect(() => parseResourceAdoption({ ...adoption, ...change }, id, id)).toThrow();
  }
});
