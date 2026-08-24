import { spawn } from "node:child_process";
import { resolve } from "node:path";

const hostPath = resolve(
  process.argv[2] ||
    "dist/blueprint-agent-host-windows-x64/blueprint-agent-host.exe",
);

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(body.byteLength, 0);
  return Buffer.concat([prefix, body]);
}

function openSession(modelId) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(hostPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Native host smoke test timed out"));
    }, 5_000);
    let stdout = Buffer.alloc(0);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.byteLength < 4) return;
      const bodyLength = stdout.readUInt32LE(0);
      if (stdout.byteLength < bodyLength + 4) return;
      clearTimeout(timeout);
      const message = JSON.parse(stdout.subarray(4, bodyLength + 4).toString("utf8"));
      child.kill();
      resolveResult({ message, stderr });
    });
    child.stdin.end(
      frame({
        protocolVersion: 1,
        type: "session.open",
        requestId: `smoke-${modelId}`,
        sessionId: "smoke-session",
        input: { apiKey: "smoke-test-key", modelId },
      }),
    );
  });
}

const accepted = await openSession("deepseek-v4-flash");
if (accepted.message.input?.kind !== "session.opened" || accepted.message.seq !== 0) {
  throw new Error(`Expected session.opened, got ${JSON.stringify(accepted.message)}`);
}
if (accepted.stderr.trim()) {
  throw new Error(`Native host wrote unexpected stderr: ${accepted.stderr.trim()}`);
}

const rejected = await openSession("unsupported-model");
if (
  rejected.message.input?.kind !== "session.error" ||
  rejected.message.input?.code !== "AGENT_ERROR" ||
  rejected.message.seq !== 0
) {
  throw new Error(`Expected safe session.error, got ${JSON.stringify(rejected.message)}`);
}

process.stdout.write("Native host session smoke passed (opened + safe rejection).\n");
