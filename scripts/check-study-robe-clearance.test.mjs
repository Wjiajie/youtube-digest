// Local asset regression; requires the documented ignored v15 source and offline Blender.
// This is not part of CI's asset-free application suite.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const source = resolve(".tools/asset-studies/dual-theme-v15/eastern.blend");
const blender = resolve(".tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender");
const expectedHash = "d6fa555d9f9121c36a1c4bedecd8d89ca2f8659eae97b4d5551d4eeb92e2e72c";
function inspect(action, frame) {
  const hash = () => createHash("sha256").update(readFileSync(source)).digest("hex");
  assert.equal(hash(), expectedHash, "Only the documented v15 fixture is used");
  const result = spawnSync(blender, ["--background", "--factory-startup", "--disable-autoexec", "--offline-mode",
    source, "--python-exit-code", "1", "--python", "scripts/check-study-robe-clearance.py", "--", action, String(frame)],
    { encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(hash(), expectedHash, "Read-only probe must not modify the source");
  const line = result.stdout.split("\n").find(line => line.startsWith("ROBE_CLEARANCE "));
  assert.ok(line, result.stderr);
  return { status: result.status, report: JSON.parse(line.slice("ROBE_CLEARANCE ".length)) };
}

test("high kick reports the actual intersecting waist edge, not only loose cloth contacts", () => {
  const { status, report } = inspect("Kick_Left", 8);
  assert.equal(status, 1, "The existing full contact gate must stay red");
  assert.equal(report.actions[0].waist_failing_frames, 1);
  assert.ok(report.actions[0].maximum_waist_crossings > 0);
  const witness = report.worst_witnesses[0].waist_witnesses.find(witness =>
    witness.robe === "Eastern / split robe L front" && witness.vertices.join(",") === "2,3");
  assert.ok(witness, "Known top-row edge 2–3 is intersected by the raised leg");
});

test("a cleared neutral pose has neither cloth nor waist crossings", () => {
  const { status, report } = inspect("Idle_Sword", 0);
  assert.equal(status, 0);
  assert.equal(report.actions[0].failing_frames, 0);
  assert.equal(report.actions[0].waist_failing_frames, 0);
  assert.equal(report.actions[0].maximum_waist_crossings, 0);
  assert.deepEqual(report.worst_witnesses, []);
});
