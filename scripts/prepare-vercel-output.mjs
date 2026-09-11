import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

// @vercel/next adds app-local .env files outside Next's output tracing rules.
// Prebuilt uploads deliberately exclude those files. Runtime configuration must
// come from the deployment environment, not the developer's local files.
const output = resolve(process.argv[2] ?? ".vercel/output");
const functions = resolve(output, "functions");
const configs = (await readdir(functions, { recursive: true })).filter((file) => file.endsWith("/.vc-config.json"));
assert(configs.length > 0, "No Vercel functions found; run vercel build first.");
const isEnvFile = (file) => /^\.env(?:\.|$)/.test(basename(file));
let removed = 0;
for (const relative of configs) {
  const file = resolve(functions, relative);
  const config = JSON.parse(await readFile(file, "utf8"));
  if (!config.filePathMap) continue;
  let changed = false;
  for (const [target, source] of Object.entries(config.filePathMap)) {
    assert.equal(typeof source, "string", "Unsupported Vercel file mapping.");
    if (isEnvFile(target) || isEnvFile(source)) {
      delete config.filePathMap[target];
      removed++;
      changed = true;
    }
  }
  if (changed) await writeFile(file, JSON.stringify(config, null, 2) + "\n");
}
console.log(`Prepared ${configs.length} Vercel function configurations; removed ${removed} local environment file references.`);
