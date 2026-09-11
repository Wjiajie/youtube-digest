import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("prebuilt preparation removes local env dependencies while preserving Skills and injected runtime configuration", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "blueprint-vercel-output-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const directory = join(output, "functions/api/planning.func");
  await mkdir(directory, { recursive: true });
  const config = { runtime: "nodejs24.x", environment: { PLATFORM_SETTING: "retained" }, filePathMap: {
    "apps/web/.env.local": "apps/web/.env.local",
    "apps/web/.env.example": "apps/web/.env.example",
    "apps/web/.env": "apps/web/.env",
    "renamed-config": "apps/web/.env.production",
    "apps/web/src/skills/plan/SKILL.md": "apps/web/src/skills/plan/SKILL.md",
    "apps/web/.next/route.js": "apps/web/.next/route.js",
  } };
  const file = join(directory, ".vc-config.json");
  await writeFile(file, JSON.stringify(config));
  const run = () => spawnSync(process.execPath, ["scripts/prepare-vercel-output.mjs", output], { encoding: "utf8" });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(prepared, { ...config, filePathMap: {
    "apps/web/src/skills/plan/SKILL.md": "apps/web/src/skills/plan/SKILL.md",
    "apps/web/.next/route.js": "apps/web/.next/route.js",
  } });
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), prepared);
});
