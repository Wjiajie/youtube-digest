// Optional real-asset Blender/Chromium integration; not asset-free CI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("real robe corrective slots survive export, animation and production CPU/GPU skinning", () => {
  const built = spawnSync(".tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender", [
    "--background", "--factory-startup", "--disable-autoexec", "--offline-mode",
    ".tools/asset-studies/dual-theme-v17/eastern.blend", "--python-exit-code", "1",
    "--python", "scripts/build-morph-transport-witness.py",
  ], { encoding: "utf8", timeout: 90_000, maxBuffer: 2_000_000 });
  assert.ifError(built.error);
  assert.equal(built.status, 0, built.stderr + built.stdout);
  const directory = built.stdout.split("\n").find(line => line.startsWith("MORPH_TRANSPORT_FIXTURE "))?.slice("MORPH_TRANSPORT_FIXTURE ".length);
  assert.ok(directory, built.stdout);
  const check = variant => spawnSync(process.execPath, ["scripts/check-morph-transport.mjs", directory, variant],
    { encoding: "utf8", timeout: 45_000, maxBuffer: 2_000_000 });
  const control = check("unregistered-control");
  assert.ifError(control.error);
  assert.equal(control.status, 1, control.stdout + control.stderr);
  assert.match(control.stderr, /Morph animation disagrees: Kick_Left 0 != 0.5/);
  const corrected = check("corrective");
  assert.ifError(corrected.error);
  assert.equal(corrected.status, 0, corrected.stderr);
  const record = corrected.stdout.split("\n").find(line => line.startsWith("MORPH_TRANSPORT "));
  assert.ok(record, corrected.stdout);
  const report = JSON.parse(record.slice("MORPH_TRANSPORT ".length));
  assert.equal(report.clips, 24);
  assert.deepEqual(report.results.map(row => [row.action, row.frame, row.value]), [
    ["Idle_Neutral", 0, 0], ["Kick_Left", 7, .5], ["Kick_Left", 7.03125, .515625],
    ["Kick_Left", 7.5, .75], ["Kick_Left", 7.53125, .765625],
    ["Kick_Left", 8, 1], ["Roll", 34, 0], ["Idle_Neutral", 0, 0],
  ]);
  for (const row of report.results) {
    assert.equal(row.vertices, 728);
    assert.ok(row.maxError < .0001);
    assert.equal(row.views.length, 3);
  }
  assert.deepEqual(report.shaderErrors, []);
  console.log(`Evidence: ${directory}`);
});
