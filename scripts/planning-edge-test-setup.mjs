import { spawn } from "node:child_process";
import { localSupabaseTestConfig } from "./local-supabase-test-config.mjs";

// Starts only the local Edge runtime; credentials stay inside that runtime.
export default async function setup() {
  localSupabaseTestConfig(); // Refuse linked/hosted projects before starting anything.
  const child = spawn(process.env.BLUEPRINT_SUPABASE_BIN ?? "supabase", ["functions", "serve", "--env-file", "scripts/planning-worker.fixture.env"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  // CLI/Edge diagnostics can contain request context. Do not echo them into test output.
  let runtimeReady = false;
  const detectReady = chunk => { if (String(chunk).includes("Serving functions on http://127.0.0.1:54321/functions/v1/")) runtimeReady = true; };
  child.stdout.on("data", detectReady); child.stderr.on("data", detectReady);
  let spawnError;
  child.on("error", error => { spawnError = error; });
  const exited = new Promise(resolve => child.once("exit", resolve));
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null || spawnError) return;
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError || child.exitCode !== null) throw new Error("Local Edge process could not start");
      // A previous local runtime may still answer while the CLI replaces it. Its
      // health response is not readiness evidence for this newly spawned runtime.
      const response = runtimeReady ? await fetch("http://127.0.0.1:54321/functions/v1/planning-worker", { signal: AbortSignal.timeout(2000) }).catch(() => null) : null;
      if (response?.status === 405) return stop;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Local planning Edge worker did not become ready");
  } catch (error) { await stop(); throw error; }
}
