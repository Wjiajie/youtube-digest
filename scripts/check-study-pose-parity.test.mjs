// Actual local Blender + production browser-loader regression, not asset-free CI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("source/export pose comparison exposes tiny weight loss instead of silently claiming equality", () => {
  const hashes = () => ["blend", "glb"].map(extension => createHash("sha256").update(
    readFileSync(`.tools/asset-studies/dual-theme-v16/eastern.${extension}`)).digest("hex"));
  const expected = ["e5b8b8735c59e6a749781a527847cce41130d97f694ee8a5c89af3b6cc653d52", "5fdfcd58a1596115c497417932a847c7f0d26d430fb0e27f45fcfb1660ce04d1"];
  assert.deepEqual(hashes(), expected);
  const result = spawnSync(process.execPath, ["scripts/check-study-pose-parity.mjs", "16"],
    { encoding: "utf8", timeout: 45_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(hashes(), expected);
  const line = result.stdout.split("\n").find(line => line.startsWith("STUDY_POSE_PARITY "));
  assert.ok(line, result.stdout);
  const report = JSON.parse(line.slice("STUDY_POSE_PARITY ".length));
  assert.equal(report.source, expected[0]);
  assert.equal(report.glb, expected[1]);
  assert.equal(report.fps, 24);
  assert.deepEqual(report.results.map(pose => [pose.action, pose.frame]), [["Idle_Neutral", 0], ["Kick_Left", 7], ["Kick_Left", 8], ["Roll", 34]]);
  assert.deepEqual(report.weightLosses.map(loss => loss.sourceVertex).sort((a, b) => a - b), [240, 280, 287, 313]);
  for (const loss of report.weightLosses) {
    assert.equal(loss.target, "Eastern / sash");
    assert.ok(Object.values(loss.dropped).every(weight => weight > 0 && weight <= .0001));
  }
  for (const pose of report.results) {
    assert.equal(pose.actionTime, pose.time);
    assert.equal(pose.rows.length, 3);
    assert.equal(pose.rows.reduce((sum, row) => sum + row.vertices, 0), 1576);
    for (const row of pose.rows) assert.ok(row.maxError < (row.target === "Casual_Body" ? .000002 : .000020));
  }
});
