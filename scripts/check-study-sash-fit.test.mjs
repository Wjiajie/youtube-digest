// Local ignored assets are required; this is not the asset-free CI suite.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const fixtures = {
  15: ["d6fa555d9f9121c36a1c4bedecd8d89ca2f8659eae97b4d5551d4eeb92e2e72c", "d5eea54fbd24f489c71ce256f3c3e6cecaf4b0daf546896ab0484a95cc3242df"],
  16: ["e5b8b8735c59e6a749781a527847cce41130d97f694ee8a5c89af3b6cc653d52", "5fdfcd58a1596115c497417932a847c7f0d26d430fb0e27f45fcfb1660ce04d1"],
};
function inspect(revision, ...args) {
  const base = resolve(`.tools/asset-studies/dual-theme-v${revision}/eastern`);
  const hashes = () => ["blend", "glb"].map(extension => createHash("sha256").update(readFileSync(`${base}.${extension}`)).digest("hex"));
  assert.deepEqual(hashes(), fixtures[revision]);
  const result = spawnSync(resolve(".tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender"),
    ["--background", "--factory-startup", "--disable-autoexec", "--offline-mode", `${base}.blend`,
      "--python-exit-code", "1", "--python", "scripts/check-study-sash-fit.py", "--", ...args],
    { encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.deepEqual(hashes(), fixtures[revision], "Neither source nor exported asset may change");
  const line = result.stdout.split("\n").find(line => line.startsWith("SASH_FIT "));
  assert.ok(line, result.stderr || result.stdout);
  const report = JSON.parse(line.slice("SASH_FIT ".length));
  assert.equal(report.verified_cloth_triangles, 488);
  assert.equal(report.source_sha256, fixtures[revision][0]);
  assert.equal(report.glb_sha256, fixtures[revision][1]);
  return { status: result.status, report };
}

test("the original rest sash fails surface fit after verifying the exported torso", () => {
  const { status, report } = inspect(15, "--rest");
  assert.equal(status, 1);
  assert.equal(report.failing_samples, 1);
  assert.ok(report.max_distance_m > .06);
});

test("the trial rest sash fits the actual world-transformed exported torso", () => {
  const { status, report } = inspect(16, "--rest");
  assert.equal(status, 0);
  assert.equal(report.samples, 1);
  assert.equal(report.failing_samples, 0);
  assert.ok(report.min_distance_m > .001 && report.max_distance_m < .012);
});

test("a high kick still fails fit against fixed exported topology", () => {
  const { status, report } = inspect(16, "Kick_Left", "7");
  assert.equal(status, 1);
  assert.equal(report.failing_samples, 1);
  assert.equal(report.first_failures[0].action, "Kick_Left");
  assert.ok(report.first_failures[0].witnesses.some(witness => witness.signed_distance_m <= .001));
});
