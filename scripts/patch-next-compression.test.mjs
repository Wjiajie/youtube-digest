import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { patchNextCompression } from "./patch-next-compression.mjs";

test("dependency repair is idempotent and refuses unknown versions or bytes without changing them", () => {
  const require = createRequire(import.meta.url);
  const installed = dirname(require.resolve("next/package.json"));
  const directory = mkdtempSync(join(tmpdir(), "blueprint-compression-"));
  const file = join(directory, "dist/compiled/compression/index.js");
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "16.3.3" }));
    const current = readFileSync(join(installed, "dist/compiled/compression/index.js"));
    writeFileSync(file, current);
    patchNextCompression(directory);
    const repaired = readFileSync(file);
    assert.equal(patchNextCompression(directory), "already-patched");
    assert.deepEqual(readFileSync(file), repaired);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "16.3.4" }));
    assert.throws(() => patchNextCompression(directory), /Review\/remove/);
    assert.deepEqual(readFileSync(file), repaired);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "16.3.3" }));
    const unknown = Buffer.from("unknown dependency contents");
    writeFileSync(file, unknown);
    assert.throws(() => patchNextCompression(directory), /Unexpected compression bytes/);
    assert.deepEqual(readFileSync(file), unknown);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
