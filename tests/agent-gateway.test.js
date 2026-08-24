const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentGateway } = require("../agent-gateway.js");

function createNativePort(onPostMessage) {
  const messages = [];
  const messageListeners = [];
  const disconnectListeners = [];
  const port = {
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      },
    },
    postMessage(message) {
      messages.push(structuredClone(message));
      onPostMessage?.(message, port);
    },
    disconnect() {},
    emit(message) {
      for (const listener of messageListeners) listener(message);
    },
    emitDisconnect() {
      for (const listener of disconnectListeners) listener();
    },
  };
  return { port, messages };
}

function responseFor(request, seq, input) {
  return {
    protocolVersion: 1,
    type: "event",
    requestId: request.requestId,
    sessionId: request.sessionId,
    ...(request.capability ? { capability: request.capability } : {}),
    seq,
    input,
  };
}

async function withChrome(chromeApi, callback) {
  const hadChrome = Object.hasOwn(globalThis, "chrome");
  const previousChrome = globalThis.chrome;
  globalThis.chrome = chromeApi;
  try {
    return await callback();
  } finally {
    if (hadChrome) globalThis.chrome = previousChrome;
    else delete globalThis.chrome;
  }
}

test("AgentGateway opens one credentialed session and keeps the key out of capability input", async () => {
  const { port, messages } = createNativePort((message, nativePort) => {
    if (message.type === "session.open") {
      queueMicrotask(() =>
        nativePort.emit(responseFor(message, 0, { kind: "session.opened" })),
      );
      return;
    }
    if (message.type === "request") {
      queueMicrotask(() => {
        nativePort.emit(
          responseFor(message, 0, {
            kind: "agent.result",
            result: { explanation: "Local Agent result" },
          }),
        );
        nativePort.emit(responseFor(message, 1, { kind: "agent.completed" }));
      });
    }
  });

  await withChrome(
    { runtime: { connectNative: () => port } },
    async () => {
      const gateway = new AgentGateway({
        getSessionConfig: async () => ({
          apiKey: "session-only-secret",
          modelId: "deepseek-v4-flash",
        }),
      });
      const result = await gateway.explainSelection({
        selectedText: "explain me",
      });

      assert.deepEqual(result, { explanation: "Local Agent result" });
    },
  );

  const sessionOpen = messages.find((message) => message.type === "session.open");
  const request = messages.find((message) => message.type === "request");
  assert.equal(sessionOpen.input.apiKey, "session-only-secret");
  assert.equal(sessionOpen.input.modelId, "deepseek-v4-flash");
  assert.equal(request.capability, "learning.explain_selection");
  assert.deepEqual(request.input, { selectedText: "explain me" });
  assert.equal(JSON.stringify(request.input).includes("session-only-secret"), false);
});

test("AgentGateway timeout is retryable and sends an abort for the timed-out request", async () => {
  const { port, messages } = createNativePort((message, nativePort) => {
    if (message.type === "session.open") {
      queueMicrotask(() =>
        nativePort.emit(responseFor(message, 0, { kind: "session.opened" })),
      );
    }
  });

  await withChrome(
    { runtime: { connectNative: () => port } },
    async () => {
      const gateway = new AgentGateway({
        timeoutMs: 5,
        getSessionConfig: async () => ({ apiKey: "test-key" }),
      });
      await assert.rejects(
        gateway.analyzeVideo({ transcriptText: "[0:00] Hello" }),
        (error) =>
          error.code === "AGENT_TIMEOUT" &&
          error.retryable === true &&
          /did not respond/i.test(error.message),
      );
    },
  );

  const request = messages.find((message) => message.type === "request");
  const abort = messages.find((message) => message.type === "agent.abort");
  assert.equal(abort.requestId, request.requestId);
  assert.equal(abort.sessionId, request.sessionId);
});

test("AgentGateway preserves safe host error code and retryability", async () => {
  const { port } = createNativePort((message, nativePort) => {
    if (message.type === "session.open") {
      queueMicrotask(() =>
        nativePort.emit(responseFor(message, 0, { kind: "session.opened" })),
      );
      return;
    }
    if (message.type === "request") {
      queueMicrotask(() =>
        nativePort.emit(
          responseFor(message, 0, {
            kind: "agent.error",
            code: "RATE_LIMITED",
            message: "The model provider rate-limited this request.",
            retryable: true,
          }),
        ),
      );
    }
  });

  await withChrome(
    { runtime: { connectNative: () => port } },
    async () => {
      const gateway = new AgentGateway({
        getSessionConfig: async () => ({ apiKey: "test-key" }),
      });
      await assert.rejects(
        gateway.polishNote({ targetText: "Raw note" }),
        (error) =>
          error.code === "RATE_LIMITED" &&
          error.retryable === true &&
          /rate-limited/i.test(error.message),
      );
    },
  );
});

test("AgentGateway fails closed when host events arrive out of sequence", async () => {
  const { port } = createNativePort((message, nativePort) => {
    if (message.type === "session.open") {
      queueMicrotask(() =>
        nativePort.emit(responseFor(message, 0, { kind: "session.opened" })),
      );
      return;
    }
    if (message.type === "request") {
      queueMicrotask(() =>
        nativePort.emit(
          responseFor(message, 1, {
            kind: "agent.result",
            result: { explanation: "must not be accepted" },
          }),
        ),
      );
    }
  });

  await withChrome(
    { runtime: { connectNative: () => port } },
    async () => {
      const gateway = new AgentGateway({
        getSessionConfig: async () => ({ apiKey: "test-key" }),
      });
      await assert.rejects(
        gateway.explainSelection({ selectedText: "text" }),
        (error) => error.code === "PROTOCOL_ERROR" && /out of order/i.test(error.message),
      );
    },
  );
});

test("AgentGateway keeps a request pending through the Host started, result, completed sequence", async () => {
  let capabilityRequest = null;
  const { port } = createNativePort((message, nativePort) => {
    if (message.type === "session.open") {
      queueMicrotask(() =>
        nativePort.emit(responseFor(message, 0, { kind: "session.opened" })),
      );
      return;
    }
    if (message.type === "request") capabilityRequest = message;
  });

  await withChrome(
    { runtime: { connectNative: () => port } },
    async () => {
      const gateway = new AgentGateway({
        getSessionConfig: async () => ({ apiKey: "test-key" }),
      });
      let settled = false;
      const resultPromise = gateway
        .explainSelection({ selectedText: "follow the real host sequence" })
        .then((result) => {
          settled = true;
          return result;
        });

      while (!capabilityRequest) await new Promise((resolve) => setImmediate(resolve));
      port.emit(responseFor(capabilityRequest, 0, { kind: "agent.started" }));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, "agent.started is progress, not terminal completion");
      assert.equal(gateway.pending.has(capabilityRequest.requestId), true);

      port.emit(
        responseFor(capabilityRequest, 1, {
          kind: "agent.result",
          result: { explanation: "result after started" },
        }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, "agent.result remains pending until agent.completed");

      port.emit(responseFor(capabilityRequest, 2, { kind: "agent.completed" }));
      assert.deepEqual(await resultPromise, { explanation: "result after started" });
      assert.equal(gateway.pending.has(capabilityRequest.requestId), false);
    },
  );
});

test("AgentGateway closes and reopens its native session when the key or model changes", async () => {
  const sessionConfigs = [
    { apiKey: "first-session-key", modelId: "deepseek-v4-flash" },
    { apiKey: "rotated-session-key", modelId: "deepseek-v4-flash-next" },
  ];
  let configIndex = 0;
  const nativeConnections = [];

  await withChrome(
    {
      runtime: {
        connectNative() {
          const connection = createNativePort((message, nativePort) => {
            if (message.type === "session.open") {
              queueMicrotask(() =>
                nativePort.emit(responseFor(message, 0, { kind: "session.opened" })),
              );
              return;
            }
            if (message.type === "request") {
              queueMicrotask(() => {
                nativePort.emit(
                  responseFor(message, 0, {
                    kind: "agent.result",
                    result: { explanation: `answer-${nativeConnections.length}` },
                  }),
                );
                nativePort.emit(responseFor(message, 1, { kind: "agent.completed" }));
              });
            }
          });
          nativeConnections.push(connection);
          return connection.port;
        },
      },
    },
    async () => {
      const gateway = new AgentGateway({
        getSessionConfig: async () => sessionConfigs[configIndex],
      });

      await gateway.explainSelection({ selectedText: "first" });
      configIndex = 1;
      await gateway.explainSelection({ selectedText: "second" });
    },
  );

  assert.equal(nativeConnections.length, 2, "changed credentials must open a new native port");
  const close = nativeConnections[0].messages.find(
    (message) => message.type === "session.close",
  );
  assert.ok(close, "the old host session must be closed before it is replaced");
  const reopened = nativeConnections[1].messages.find(
    (message) => message.type === "session.open",
  );
  assert.deepEqual(reopened.input, sessionConfigs[1]);
});

test("an early planner abort reaches the eventual request and a later prompt still completes", async () => {
  let pendingSessionOpen = null;
  const { port, messages } = createNativePort((message, nativePort) => {
    if (message.type === "session.open") {
      pendingSessionOpen = message;
      return;
    }
    if (message.type === "request" && message.input.text === "second prompt") {
      queueMicrotask(() => {
        nativePort.emit(
          responseFor(message, 0, {
            kind: "agent.proposal",
            proposal: { markdown: "## Second", summary: "second completed" },
          }),
        );
        nativePort.emit(
          responseFor(message, 1, {
            kind: "agent.result",
            result: { proposal: { markdown: "## Second", summary: "second completed" } },
          }),
        );
        nativePort.emit(responseFor(message, 2, { kind: "agent.completed" }));
      });
    }
    if (message.type === "agent.abort") {
      queueMicrotask(() =>
        nativePort.emit(responseFor(message, 0, { kind: "agent.aborted" })),
      );
    }
  });

  await withChrome(
    { runtime: { connectNative: () => port } },
    async () => {
      const gateway = new AgentGateway({
        timeoutMs: 1_000,
        getSessionConfig: async () => ({ apiKey: "test-key" }),
      });
      const first = gateway.planBlueprint({ text: "first prompt" });
      await first.abort();

      assert.ok(pendingSessionOpen, "the abort must occur while session setup is pending");
      port.emit(responseFor(pendingSessionOpen, 0, { kind: "session.opened" }));
      await new Promise((resolve) => setImmediate(resolve));

      const second = gateway.planBlueprint({ text: "second prompt" });
      const secondEvents = [];
      for await (const event of second) secondEvents.push(event);

      const firstRequest = messages.find(
        (message) => message.type === "request" && message.input.text === "first prompt",
      );
      const firstAbort = messages.find(
        (message) =>
          message.type === "agent.abort" && message.requestId === firstRequest?.requestId,
      );

      // Keep this regression test deterministic even while the old implementation is Red.
      if (firstRequest && !firstAbort) {
        port.emit(responseFor(firstRequest, 0, { kind: "agent.aborted" }));
      }

      assert.ok(firstRequest, "the pending planner request must eventually receive an ID");
      assert.ok(firstAbort, "an abort requested before ID assignment must be replayed for that ID");
      assert.equal(
        secondEvents.some(
          (event) => event.kind === "agent.proposal" && event.proposal.summary === "second completed",
        ),
        true,
        "aborting the first prompt must not silently block a second planner prompt",
      );
    },
  );
});
