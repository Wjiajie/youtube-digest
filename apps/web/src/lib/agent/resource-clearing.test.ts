import { expect, it } from "vitest";
import { parseResourceRun } from "./resource-run";
import { parseResourceAdoption } from "./resource-adoption";

const id = "10000000-0000-4000-8000-000000000001";
const date = "2026-09-11T01:00:00Z";
const receipt = { id, owner_id: id, blueprint_id: id, blueprint_version: 1, node_id: id, status: "cleared", created_at: date, expires_at: date, cleared_at: date };
const run = { ...receipt, kind: "discover", source_run_id: null, preferences: null, learner_context: null, input_blueprint: null, input_discovery: null, skill: null, result: null };
it("reads an explicitly cleared resource receipt without inventing an empty successful blueprint", () => {
  expect(parseResourceRun(run, id, id)).toMatchObject({ id, status: "cleared", clearedAt: date, blueprint: null, result: null, preferences: null });
});
it("reads a cleared adoption as a receipt without keeping provider video data", () => {
  const row = { ...receipt, source_run_id: id, video_id: null, replace_binding_id: null, new_binding_id: id,
    verified_at: date, valid_until: "2026-09-11T01:10:00Z", proposal_id: id, result: null };
  expect(parseResourceAdoption(row, id, id)).toMatchObject({ status: "cleared", videoId: null, proposalId: id, clearedAt: date, result: null });
});
it("rejects residual resource content, missing clearing evidence and mismatched receipt identities", () => {
  for (const field of ["preferences", "learner_context", "input_blueprint", "input_discovery", "skill", "result"]) {
    expect(() => parseResourceRun({ ...run, [field]: { private: "DO_NOT_SHOW" } }, id, id)).toThrow();
  }
  expect(() => parseResourceRun({ ...run, cleared_at: null }, id, id)).toThrow();
  expect(() => parseResourceRun({ ...run, status: "ready" }, id, id)).toThrow();
  expect(() => parseResourceRun(run, "20000000-0000-4000-8000-000000000001", id)).toThrow();
  expect(() => parseResourceRun({ ...run, kind: "captions" }, id, id)).toThrow();
});
it("does not accept a cleared adoption with a retained video or verification body", () => {
  const row = { ...receipt, source_run_id: id, video_id: null, replace_binding_id: null, new_binding_id: id,
    verified_at: null, valid_until: null, proposal_id: null, result: null };
  expect(() => parseResourceAdoption({ ...row, video_id: "abcdefghijk" }, id, id)).toThrow();
  expect(() => parseResourceAdoption({ ...row, result: { status: "cancelled" } }, id, id)).toThrow();
  expect(() => parseResourceAdoption({ ...row, cleared_at: null }, id, id)).toThrow();
});
