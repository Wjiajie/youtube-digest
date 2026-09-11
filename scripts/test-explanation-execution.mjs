import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { localSupabaseTestConfig } from "./local-supabase-test-config.mjs";

// Local-only actual Deno entry + Auth/PostgREST + SDK loopback verification.
// No provider API key is needed. Never replace an already running Edge process.
const cli = process.env.BLUEPRINT_SUPABASE_BIN ?? "supabase";
const local = localSupabaseTestConfig();
const services = () => execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).trim().split("\n");
const before = services();
assert(!before.some(name => name.includes("edge_runtime")), "An Edge process is already running; preserve it");
const directory = await mkdtemp(new URL("../.goal-loop/explanation-edge-", import.meta.url).pathname);
const envFile = `${directory}/worker.env`, secret = randomBytes(32).toString("hex");
let edge, edgeExit, tests;
let stopping = false;
const stop = () => { stopping = true; tests?.kill("SIGTERM"); edge?.kill("SIGTERM"); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  await writeFile(envFile, `BLUEPRINT_EXPLANATION_WORKER_SECRET=${secret}\n`, { mode: 0o600 });
  edge = spawn(cli, ["functions", "serve", "--env-file", envFile], { stdio: ["ignore", "pipe", "pipe"] });
  edgeExit = new Promise(resolve => edge.once("exit", resolve));
  let ready = false, failed = false;
  edge.on("error", () => { failed = true; });
  const detect = chunk => { if (String(chunk).includes("Serving functions on http://127.0.0.1:54321/functions/v1/")) ready = true; };
  edge.stdout.on("data", detect); edge.stderr.on("data", detect);
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    if (stopping || failed || edge.exitCode !== null) throw new Error("Local Edge startup failed");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, "Owned Edge process did not become ready");
  const response = await fetch(`${local.API_URL}/functions/v1/explanation-worker`, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 405, "Actual Deno index must reject unsupported methods");
  assert.equal((await response.json()).error.message, "EXPLANATION_INVALID", "Actual Deno handler must answer");
  console.log("EXPLANATION_EDGE_READY actualDeno=true provider=loopback");
  tests = spawn("npx", ["vitest", "run", "--config", "vitest.agent-runs.config.ts", "apps/web/agent-integration/explanation-execution.spec.ts", ...process.argv.slice(2)], {
    env: { ...process.env, BLUEPRINT_EXPLANATION_EDGE_TEST_SECRET: secret }, stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => { tests.once("error", reject); tests.once("exit", resolve); });
  if (code !== 0) process.exitCode = 1;
} catch (error) {
  // Do not echo subprocess diagnostics, credentials or raw response bodies.
  console.error("EXPLANATION_EDGE_FAILED", error instanceof assert.AssertionError ? error.message.split("\n")[0] : "runtime failure");
  process.exitCode = 1;
} finally {
  if (tests && tests.exitCode === null && tests.signalCode === null) tests.kill("SIGTERM");
  if (edge && edge.exitCode === null && edge.signalCode === null) {
    edge.kill("SIGTERM");
    let timer;
    await Promise.race([edgeExit, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer);
    if (edge.exitCode === null && edge.signalCode === null) { edge.kill("SIGKILL"); await edgeExit; }
  }
  await unlink(envFile).catch(error => { if (error.code !== "ENOENT") throw error; });
  await rmdir(directory);
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
  const after = services();
  assert(before.every(name => after.includes(name)), "Existing local services must remain running");
  console.log("EXPLANATION_EDGE_CLEANUP owned runtime stopped; ephemeral credential removed; existing services preserved");
}
