import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { localSupabaseTestConfig } from "./local-supabase-test-config.mjs";

export default async function setup() {
  localSupabaseTestConfig();
  const originalServices = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).trim().split("\n");
  if (originalServices.some(name => name.includes("edge_runtime"))) throw new Error("Existing Edge runtime must not be replaced");
  const workerKey = process.env.BLUEPRINT_EXPLANATION_TEST_WORKER_SECRET;
  if (!workerKey || !/^[a-f0-9]{64}$/.test(workerKey)) throw new Error("Missing isolated explanation credential");
  const extensionClientId = process.env.BLUEPRINT_EXPLANATION_TEST_EXTENSION_CLIENT_ID;
  if (extensionClientId && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(extensionClientId)) throw new Error("Invalid isolated OAuth client ID");
  const directory = await mkdtemp(new URL("../.goal-loop/explanation-http-", import.meta.url).pathname);
  const envFile = `${directory}/worker.env`;
  await writeFile(envFile, `BLUEPRINT_EXPLANATION_WORKER_SECRET=${workerKey}\n${extensionClientId ? `BLUEPRINT_EXTENSION_OAUTH_CLIENT_ID=${extensionClientId}\n` : ""}`, { mode: 0o600 });
  const child = spawn(process.env.BLUEPRINT_SUPABASE_BIN ?? "supabase", ["functions", "serve", "--env-file", envFile], { stdio: ["ignore", "pipe", "pipe"] });
  let ready = false, spawnError = false, mode = "ready", holdAuth = false, uncaughtExceptions = 0;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.on("error", () => { spawnError = true; });
  const detect = chunk => { if (String(chunk).includes("Serving functions on http://127.0.0.1:54321/functions/v1/")) ready = true; };
  child.stdout.on("data", detect); child.stderr.on("data", detect);
  const calls = [], pending = new Set();
  const json = (response, value, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
  const server = createServer((request, response) => {
    if (request.url === "/fixture/calls" && request.method === "GET") return json(response, calls);
    if (request.url === "/fixture/reset" && request.method === "POST") { calls.length = 0; mode = "ready"; holdAuth = false; uncaughtExceptions = 0; return json(response, { ok: true }); }
    if (request.url === "/fixture/uncaught" && request.method === "POST") { uncaughtExceptions++; return json(response, { ok: true }); }
    if (request.url === "/fixture/uncaught" && request.method === "GET") return json(response, { count: uncaughtExceptions });
    if (request.url === "/fixture/hold" && request.method === "POST") { mode = "hold"; return json(response, { ok: true }); }
    if (request.url === "/fixture/hold-auth" && request.method === "POST") { holdAuth = true; return json(response, { ok: true }); }
    if (["/fixture/auth/user", "/fixture/auth/.well-known/jwks.json"].includes(request.url) && request.method === "GET") {
      if (holdAuth) { pending.add(response); response.once("close", () => pending.delete(response)); return; }
      const destination = `http://127.0.0.1:54321/auth/v1/${request.url.slice("/fixture/auth/".length)}`;
      const headers = { apikey: request.headers.apikey ?? "" };
      if (request.headers.authorization) headers.authorization = request.headers.authorization;
      void fetch(destination, { headers, signal: AbortSignal.timeout(10000) }).then(async upstream => {
        response.writeHead(upstream.status, { "content-type": "application/json" }); response.end(await upstream.text());
      }).catch(() => { if (!response.destroyed) json(response, { error: "Local Auth transport unavailable" }, 503); });
      return;
    }
    if (request.url !== "/chat/completions" || request.method !== "POST" || request.headers.authorization !== "Bearer explanation-fixture-model-key") return json(response, { error: "Unknown fixture request" }, 404);
    let body = ""; request.setEncoding("utf8"); request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      try {
        const input = JSON.parse(body);
        if (input.model !== "deepseek-flash" || input.stream) return json(response, { error: "Unexpected fixture model" }, 422);
        const prompt = JSON.parse(input.messages.findLast(message => message.role === "user").content);
        if (prompt.selected?.length !== 1 || prompt.selected[0].segmentIndex !== 20
          || prompt.selected[0].text !== "用自己的照片解释你的选择") return json(response, { error: "Unexpected fixture selection" }, 422);
        const answer = { kind: "explanation", meaning: "用自己的照片表达和解释选择。", reasoning: "原文要求用自己的照片解释，不是单纯观看示范。",
          background: null, checkQuestion: "你能用哪张自己的照片说明选择？", limitations: ["当前片段没有给出具体拍摄参数。"], evidence: [{ segmentIndex: 20, quote: "自己的照片" }] };
        calls.push({ path: "/chat/completions", method: "POST" });
        if (mode === "hold") { pending.add(response); response.once("close", () => pending.delete(response)); return; }
        return json(response, { id: "local-explanation-fixture", object: "chat.completion", created: 0, model: input.model,
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 31, completion_tokens: 12, total_tokens: 43 } });
      } catch { return json(response, { error: "Invalid fixture request" }, 422); }
    });
  });
  async function stop() {
    for (const response of pending) response.destroy();
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (!spawnError && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    await unlink(envFile); await rmdir(directory);
  }
  try {
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      if (spawnError || child.exitCode !== null) throw new Error("Local explanation Edge failed to start");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Local explanation Edge readiness timed out");
    const health = await fetch("http://127.0.0.1:54321/functions/v1/explanation-worker", { signal: AbortSignal.timeout(15000) });
    if (health.status !== 405) throw new Error("Actual explanation index is unavailable");
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3201, "127.0.0.1", resolve); });
    return stop;
  } catch (error) { await stop(); throw error; }
}
