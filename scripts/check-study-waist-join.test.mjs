// Optional local artifact checks, not asset-free CI or an art approval test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

function inspect(revision, expectedHash) {
  const source = resolve(`.tools/asset-studies/dual-theme-v${revision}/eastern.blend`);
  const hash = () => createHash("sha256").update(readFileSync(source)).digest("hex");
  assert.equal(hash(), expectedHash);
  const result = spawnSync(resolve(".tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender"),
    ["--background", "--factory-startup", "--disable-autoexec", "--offline-mode", source,
      "--python-exit-code", "1", "--python", "scripts/check-study-waist-join.py"], { encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error); assert.equal(result.signal, null);
  assert.equal(hash(), expectedHash, "The geometry probe is read-only");
  const line = result.stdout.split("\n").find(line => line.startsWith("WAIST_JOIN "));
  assert.ok(line, result.stderr);
  return { status: result.status, report: JSON.parse(line.slice("WAIST_JOIN ".length)) };
}

test("the current v17 waist exposes the actual height and contour mismatch", () => {
  const { status, report } = inspect(17, "18e231261cb1b6068f5c1422d6db4268e4bd2e4a1c9ec84af1806e935d42579c");
  assert.equal(status, 1); assert.equal(report.panels.length, 4);
  for (const row of report.panels) {
    assert.equal(row.within_envelope, false);
    assert.ok(row.sash_low - row.top > .035 && row.sash_low - row.top < .036);
    assert.ok(row.maximum_distance_mm > 80);
  }
});

test("the unaccepted v19 study meets rest seam proximity without claiming animation clearance", () => {
  const { status, report } = inspect(19, "4bcb5d11070938755ad38c2f8b009b8d5bd18eb1f61d2f42bf3f877f1e01c59f");
  assert.equal(status, 0); assert.equal(report.panels.length, 4);
  for (const row of report.panels) {
    assert.equal(row.within_envelope, true);
    assert.ok(row.maximum_distance_mm > 5 && row.maximum_distance_mm < 6);
  }
  assert.match(report.scope, /no animation\/collision proof/);
});
