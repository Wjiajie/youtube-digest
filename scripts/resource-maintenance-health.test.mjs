import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = new URL("./resource-maintenance-health.mjs", import.meta.url);
const flags = ["--max-success-age-seconds", "300", "--max-overdue-seconds", "120"];
const healthy = {
  version: 1, observed_at: "2026-09-11T00:10:00Z", overdue_roots: 0, oldest_overdue_at: null,
  last_attempt_at: "2026-09-11T00:09:00Z", last_finished_at: "2026-09-11T00:09:01Z", last_success_at: "2026-09-11T00:09:01Z",
  last_status: "succeeded", last_error_code: null, last_duration_ms: 1000, last_processed_owners: 2, success_count: 1, failure_count: 0,
};
function check(snapshot = healthy, args = flags) {
  const result = spawnSync(process.execPath, [script.pathname, ...args], { input: JSON.stringify(snapshot), encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("operator health uses the snapshot's database clock and emits only aggregate diagnostics", () => {
  const result = check();
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { status: "healthy", reasons: [], overdueRoots: 0, oldestOverdueSeconds: 0,
    lastSuccessAgeSeconds: 59, lastStatus: "succeeded", lastErrorCode: null });
  assert.equal(result.stderr, "");
});

test("malformed or body-bearing snapshots fail closed without echoing their contents", () => {
  const secret = "PRIVATE_GOAL_OR_SUBTITLE";
  for (const snapshot of [null, [], {}, { ...healthy, extra: secret }, { ...healthy, version: 2 },
    { ...healthy, observed_at: "2026-02-30T00:00:00Z" }, { ...healthy, last_status: secret },
    { ...healthy, last_error_code: secret }, { ...healthy, overdue_roots: -1 }, { ...healthy, overdue_roots: 0.5 },
    { ...healthy, last_duration_ms: -1 }, { ...healthy, last_processed_owners: 1001 },
    { ...healthy, oldest_overdue_at: healthy.observed_at }, { ...healthy, overdue_roots: 1 },
    { ...healthy, last_attempt_at: null }, { ...healthy, last_success_at: null }, { ...healthy, success_count: 0 },
    { ...healthy, last_status: "failed", last_error_code: null }, { ...healthy, last_status: "never_run" }]) {
    const result = check(snapshot);
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), { status: "invalid", reasons: ["invalid_input"] });
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes(secret));
  }
});

test("never-run, stale success, latest failure and overdue backlog independently fail health", () => {
  const scenarios = [
    [{ ...healthy, last_attempt_at: null, last_finished_at: null, last_success_at: null, last_status: "never_run",
      last_duration_ms: null, last_processed_owners: null, success_count: 0 }, ["never_run", "success_stale"]],
    [{ ...healthy, observed_at: "2026-09-11T00:20:00Z" }, ["success_stale"]],
    [{ ...healthy, last_status: "failed", failure_count: 1, last_error_code: "23514", last_processed_owners: null }, ["last_attempt_failed"]],
    [{ ...healthy, overdue_roots: 3, oldest_overdue_at: "2026-09-11T00:07:00Z" }, ["overdue_backlog"]],
    [{ ...healthy, observed_at: "2026-09-11T00:08:00Z" }, ["clock_inconsistent"]],
    [{ ...healthy, last_attempt_at: "2026-09-11T00:09:30Z" }, ["clock_inconsistent"]],
  ];
  for (const [snapshot, expected] of scenarios) {
    const result = check(snapshot);
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout).reasons, expected);
  }
  // Thresholds are explicit operator tolerance, not a promise that any backlog is erased.
  assert.equal(check({ ...healthy, overdue_roots: 1, oldest_overdue_at: "2026-09-11T00:08:00Z" }).status, 0);
});

test("invalid flags, oversized input and parse errors cannot leak stdin or CLI arguments", () => {
  for (const args of [[], [flags[0], "0", ...flags.slice(2)], [flags[0], "1.5", ...flags.slice(2)], [...flags, ...flags.slice(0, 2)],
    [...flags, "--private", "PRIVATE_VALUE"], [flags[0], "9007199254740992", ...flags.slice(2)]]) {
    const result = check(healthy, args);
    assert.equal(result.status, 2); assert.equal(result.stderr, "");
    assert.equal(result.stdout, '{"status":"invalid","reasons":["invalid_input"]}\n');
  }
  for (const input of ["PRIVATE_INVALID_JSON", " ".repeat(9000) + JSON.stringify(healthy), ""]) {
    const result = spawnSync(process.execPath, [script.pathname, ...flags], { input, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 2); assert.equal(result.stderr, "");
    assert.equal(result.stdout, '{"status":"invalid","reasons":["invalid_input"]}\n');
  }
});
