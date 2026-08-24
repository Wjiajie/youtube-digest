import protocol from "@blueprint/native-protocol";
import { LocalAgentService, type AgentCapability, type AgentSession } from "./agent-service.ts";

const { createFrameDecoder, encodeFrame, validateEnvelope } = protocol;
const sessions = new Map<string, AgentSession>();
const activeRequests = new Map<string, AbortController>();
const sequenceByRequest = new Map<string, number>();
const decoder = createFrameDecoder({ maxMessageBytes: 2 * 1024 * 1024 });
const service = new LocalAgentService();
const IDLE_TIMEOUT_MS = 50_000;
const HARD_TIMEOUT_MS = 120_000;

function writeEvent(
  request: Record<string, any>,
  kind: string,
  data: Record<string, unknown> = {},
) {
  const seq = sequenceByRequest.get(request.requestId) || 0;
  sequenceByRequest.set(request.requestId, seq + 1);
  const event = {
    protocolVersion: 1,
    type: "event",
    requestId: request.requestId,
    sessionId: request.sessionId,
    ...(request.capability ? { capability: request.capability } : {}),
    seq,
    input: { kind, ...data },
  };
  process.stdout.write(encodeFrame(event));
}

function safeError(error: unknown) {
  const value = error as { name?: string; code?: string; message?: string };
  if (value?.name === "AbortError") {
    return { code: "AGENT_ABORTED", message: "Agent request stopped.", retryable: true };
  }
  const message = String(value?.message || "The local Agent service failed.")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 1_000);
  const lower = message.toLowerCase();
  let code = value?.code || "AGENT_ERROR";
  if (/401|unauthorized|api key/.test(lower)) code = "INVALID_AI_KEY";
  else if (/429|rate limit/.test(lower)) code = "RATE_LIMITED";
  else if (/timeout|timed out/.test(lower)) code = "AGENT_TIMEOUT";
  return { code, message, retryable: code !== "INVALID_AI_KEY" };
}

async function handleMessage(message: Record<string, any>) {
  validateEnvelope(message);

  if (message.type === "session.open") {
    sequenceByRequest.set(message.requestId, 0);
    const apiKey = typeof message.input.apiKey === "string" ? message.input.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 512) throw new Error("A valid API key is required");
    const modelId = String(message.input.modelId || "deepseek-v4-flash");
    if (modelId !== "deepseek-v4-flash") throw new Error("Unsupported DeepSeek model");
    sessions.set(message.sessionId, { sessionId: message.sessionId, apiKey, modelId });
    writeEvent(message, "session.opened");
    return;
  }
  if (message.type === "session.close") {
    sessions.delete(message.sessionId);
    for (const controller of activeRequests.values()) controller.abort();
    return;
  }
  if (message.type === "agent.abort") {
    activeRequests.get(message.requestId)?.abort();
    return;
  }

  if (activeRequests.has(message.requestId)) throw new Error("Duplicate requestId");
  sequenceByRequest.set(message.requestId, 0);
  const session = sessions.get(message.sessionId);
  if (!session) throw new Error("Agent session is not open");
  const controller = new AbortController();
  activeRequests.set(message.requestId, controller);
  writeEvent(message, "agent.started");
  let timeoutKind: "idle" | "hard" | null = null;
  let idleTimer: NodeJS.Timeout;
  const expire = (kind: "idle" | "hard") => {
    timeoutKind = kind;
    controller.abort();
  };
  const refreshIdleTimeout = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => expire("idle"), IDLE_TIMEOUT_MS);
  };
  refreshIdleTimeout();
  const hardTimer = setTimeout(() => expire("hard"), HARD_TIMEOUT_MS);
  try {
    const result = await service.run(
      session,
      message.capability as AgentCapability,
      message.input,
      {
        signal: controller.signal,
        onTextDelta: (text) => {
          refreshIdleTimeout();
          writeEvent(message, "agent.text_delta", { text });
        },
        onProposal: (proposal) => {
          refreshIdleTimeout();
          writeEvent(message, "agent.proposal", { proposal });
        },
      },
    );
    if (timeoutKind) {
      const error = new Error(
        timeoutKind === "idle"
          ? "Agent request timed out after 50 seconds without progress."
          : "Agent request exceeded the 120 second hard timeout.",
      ) as Error & { code: string };
      error.code = "AGENT_TIMEOUT";
      throw error;
    }
    if (controller.signal.aborted) {
      writeEvent(message, "agent.aborted");
      return;
    }
    writeEvent(message, "agent.result", { result });
    writeEvent(message, "agent.completed");
  } catch (error) {
    const safe = timeoutKind
      ? {
          code: "AGENT_TIMEOUT",
          message:
            timeoutKind === "idle"
              ? "Agent request timed out after 50 seconds without progress."
              : "Agent request exceeded the 120 second hard timeout.",
          retryable: true,
        }
      : safeError(error);
    if (safe.code === "AGENT_ABORTED") writeEvent(message, "agent.aborted");
    else writeEvent(message, "agent.error", safe);
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
    activeRequests.delete(message.requestId);
    sequenceByRequest.delete(message.requestId);
  }
}

process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const message of decoder.push(chunk)) {
      handleMessage(message).catch((error) => {
        const safe = safeError(error);
        try {
          writeEvent(
            message,
            message.type === "session.open" ? "session.error" : "agent.error",
            safe,
          );
        } catch (writeError) {
          process.stderr.write(`Blueprint Agent protocol error: ${String(writeError)}\n`);
        }
      }).finally(() => {
        if (message.type === "session.open" || message.type === "session.close") {
          sequenceByRequest.delete(message.requestId);
        }
      });
    }
  } catch (error) {
    process.stderr.write(`Blueprint Agent rejected an invalid frame: ${String(error)}\n`);
    process.exitCode = 1;
    process.stdin.pause();
  }
});

process.stdin.on("end", () => {
  for (const controller of activeRequests.values()) controller.abort();
  activeRequests.clear();
  sessions.clear();
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`Blueprint Agent fatal error: ${safeError(error).message}\n`);
  process.exit(1);
});
