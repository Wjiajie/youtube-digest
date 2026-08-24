(function (root) {
  "use strict";

  const HOST_NAME = "com.blueprint.agent";
  const PROTOCOL_VERSION = 1;
  const DEFAULT_TIMEOUT_MS = 130_000;
  const CAPABILITY_BY_METHOD = Object.freeze({
    analyzeVideo: "learning.analyze_video",
    explainSelection: "learning.explain_selection",
    translateTranscriptBatch: "learning.translate_transcript_batch",
    polishNote: "learning.polish_note",
    planBlueprint: "blueprint.plan",
  });

  function randomId(prefix) {
    if (root.crypto?.randomUUID) return `${prefix}-${root.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function agentError(input = {}) {
    const error = new Error(input.message || "The local Agent service failed.");
    error.code = input.code || "AGENT_ERROR";
    error.retryable = Boolean(input.retryable);
    return error;
  }

  class AsyncEventQueue {
    constructor() {
      this.values = [];
      this.waiters = [];
      this.done = false;
      this.error = null;
      this.requestId = null;
      this.abort = async () => {};
    }

    push(value) {
      if (this.done) return;
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve({ value, done: false });
      else this.values.push(value);
    }

    finish() {
      this.done = true;
      this.flush();
    }

    fail(error) {
      this.error = error;
      this.done = true;
      this.flush();
    }

    flush() {
      for (const waiter of this.waiters.splice(0)) {
        if (this.error) waiter.reject(this.error);
        else waiter.resolve({ value: undefined, done: true });
      }
    }

    next() {
      if (this.values.length) {
        return Promise.resolve({ value: this.values.shift(), done: false });
      }
      if (this.error) return Promise.reject(this.error);
      if (this.done) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    }

    [Symbol.asyncIterator]() {
      return this;
    }
  }

  class AgentGateway {
    constructor(options = {}) {
      this.hostName = options.hostName || HOST_NAME;
      this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
      this.getSessionConfig = options.getSessionConfig || (async () => ({}));
      this.port = null;
      this.sessionId = randomId("session");
      this.sessionPromise = null;
      this.sessionConfigSignature = null;
      this.pending = new Map();
      this.connected = false;
      this.lastError = null;
    }

    async getStatus() {
      try {
        await this.ensureSession();
        return { installed: true, connected: true, error: null };
      } catch (error) {
        return {
          installed: error.code !== "HOST_NOT_FOUND",
          connected: false,
          error: { code: error.code || "HOST_UNAVAILABLE", message: error.message },
        };
      }
    }

    analyzeVideo(input) {
      return this.run(CAPABILITY_BY_METHOD.analyzeVideo, input);
    }

    explainSelection(input) {
      return this.run(CAPABILITY_BY_METHOD.explainSelection, input);
    }

    translateTranscriptBatch(input) {
      return this.run(CAPABILITY_BY_METHOD.translateTranscriptBatch, input);
    }

    polishNote(input) {
      return this.run(CAPABILITY_BY_METHOD.polishNote, input);
    }

    planBlueprint(input) {
      const queue = new AsyncEventQueue();
      queue.abortRequested = false;
      queue.abort = async () => {
        queue.abortRequested = true;
        if (queue.requestId) await this.abort(queue.requestId);
      };
      this.startRequest(
        CAPABILITY_BY_METHOD.planBlueprint,
        input,
        queue,
        (requestId) => {
          queue.requestId = requestId;
        },
      ).catch((error) => queue.fail(error));
      return queue;
    }

    async abort(requestId) {
      if (!this.port || !requestId) return;
      this.port.postMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: "agent.abort",
        requestId,
        sessionId: this.sessionId,
        input: {},
      });
    }

    async run(capability, input) {
      const queue = new AsyncEventQueue();
      const resultPromise = this.startRequest(capability, input, queue);
      return resultPromise;
    }

    async startRequest(capability, input, streamQueue, onRequestId) {
      await this.ensureSession();
      const requestId = randomId("request");
      onRequestId?.(requestId);
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pending.delete(requestId);
          const error = agentError({
            code: "AGENT_TIMEOUT",
            message: "The local Agent service did not respond in time.",
            retryable: true,
          });
          streamQueue?.fail(error);
          reject(error);
          this.abort(requestId).catch(() => {});
        }, this.timeoutMs);

        this.pending.set(requestId, {
          capability,
          expectedSeq: 0,
          resolve,
          reject,
          streamQueue,
          timeoutId,
        });
        try {
          this.port.postMessage({
            protocolVersion: PROTOCOL_VERSION,
            type: "request",
            requestId,
            sessionId: this.sessionId,
            capability,
            input: input && typeof input === "object" ? input : {},
          });
          if (streamQueue?.abortRequested) {
            this.abort(requestId).catch(() => {});
          }
        } catch (error) {
          this.rejectPending(requestId, agentError({
            code: "HOST_UNAVAILABLE",
            message: error.message || "Unable to contact the local Agent service.",
            retryable: true,
          }));
        }
      });
    }

    async ensureSession() {
      const config = await this.getSessionConfig();
      const signature = JSON.stringify([
        String(config.apiKey || ""),
        String(config.modelId || "deepseek-v4-flash"),
      ]);

      if (this.sessionPromise) await this.sessionPromise;
      if (
        this.connected &&
        this.port &&
        this.sessionConfigSignature === signature
      ) {
        return;
      }
      if (this.port || this.connected) {
        this.close(agentError({
          code: "SESSION_REPLACED",
          message: "Agent session configuration changed.",
          retryable: true,
        }));
      }
      if (!config.apiKey) {
        throw agentError({
          code: "NO_AI_KEY",
          message: "Add your DeepSeek API key in Blueprint settings.",
        });
      }
      this.sessionPromise = this.openSession(config, signature).finally(() => {
        this.sessionPromise = null;
      });
      return this.sessionPromise;
    }

    async openSession(config, signature) {
      if (!root.chrome?.runtime?.connectNative) {
        throw agentError({
          code: "HOST_UNAVAILABLE",
          message: "Native Messaging is unavailable in this browser context.",
        });
      }
      let port;
      try {
        port = root.chrome.runtime.connectNative(this.hostName);
      } catch (error) {
        throw agentError({
          code: "HOST_NOT_FOUND",
          message: error.message || "Install the Blueprint Agent service.",
        });
      }
      this.port = port;
      port.onMessage.addListener((message) => {
        if (this.port === port) this.handleMessage(message);
      });
      port.onDisconnect.addListener(() => {
        if (this.port === port) this.handleDisconnect();
      });

      const requestId = randomId("session-open");
      try {
        await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pending.delete(requestId);
          reject(agentError({
            code: "HOST_UNAVAILABLE",
            message: "The Blueprint Agent service did not open a session.",
            retryable: true,
          }));
        }, 10_000);
        this.pending.set(requestId, {
          expectedSeq: 0,
          resolve,
          reject,
          timeoutId,
          sessionOpen: true,
        });
        try {
          port.postMessage({
            protocolVersion: PROTOCOL_VERSION,
            type: "session.open",
            requestId,
            sessionId: this.sessionId,
            input: {
              apiKey: config.apiKey,
              modelId: config.modelId || "deepseek-v4-flash",
            },
          });
        } catch (error) {
          this.rejectPending(requestId, agentError({
            code: "HOST_UNAVAILABLE",
            message: error.message,
            retryable: true,
          }));
        }
        });
      } catch (error) {
        if (this.port === port) this.close(error);
        throw error;
      }
      this.connected = true;
      this.sessionConfigSignature = signature;
      this.lastError = null;
    }

    close(cause) {
      const port = this.port;
      const oldSessionId = this.sessionId;
      this.connected = false;
      this.port = null;
      this.sessionConfigSignature = null;
      this.sessionId = randomId("session");
      const error = cause || agentError({
        code: "SESSION_CLOSED",
        message: "Agent session closed.",
        retryable: true,
      });
      for (const requestId of [...this.pending.keys()]) {
        const pending = this.pending.get(requestId);
        pending?.streamQueue?.fail(error);
        this.rejectPending(requestId, error);
      }
      if (port) {
        try {
          port.postMessage({
            protocolVersion: PROTOCOL_VERSION,
            type: "session.close",
            requestId: randomId("session-close"),
            sessionId: oldSessionId,
            input: {},
          });
        } catch (_error) {
          // Disconnect below still clears the native host process and key.
        }
        try {
          port.disconnect?.();
        } catch (_error) {
          // The port may already be disconnected.
        }
      }
    }

    handleMessage(message) {
      if (
        !message ||
        message.protocolVersion !== PROTOCOL_VERSION ||
        typeof message.requestId !== "string" ||
        message.sessionId !== this.sessionId ||
        !Number.isSafeInteger(message.seq)
      ) {
        this.handleDisconnect(agentError({
          code: "PROTOCOL_ERROR",
          message: "The local Agent service sent an invalid message.",
        }));
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      if (pending.capability && message.capability !== pending.capability) {
        this.rejectPending(message.requestId, agentError({
          code: "PROTOCOL_ERROR",
          message: "The local Agent service returned the wrong capability.",
        }));
        return;
      }
      if (message.seq !== pending.expectedSeq) {
        this.rejectPending(message.requestId, agentError({
          code: "PROTOCOL_ERROR",
          message: "The local Agent service sent messages out of order.",
        }));
        return;
      }
      pending.expectedSeq += 1;
      const kind = message.input?.kind;
      if (kind === "session.opened") {
        this.resolvePending(message.requestId, message.input);
      } else if (kind === "session.error") {
        this.rejectPending(message.requestId, agentError(message.input));
      } else if (kind === "agent.started") {
        if (pending.started || pending.result !== undefined) {
          this.rejectPending(message.requestId, agentError({
            code: "PROTOCOL_ERROR",
            message: "The local Agent service sent an unexpected start event.",
          }));
          return;
        }
        pending.started = true;
      } else if (kind === "agent.text_delta" || kind === "agent.proposal") {
        pending.streamQueue?.push(message.input);
      } else if (kind === "agent.result") {
        pending.result = message.input.result;
        pending.streamQueue?.push(message.input);
      } else if (kind === "agent.completed") {
        pending.streamQueue?.finish();
        this.resolvePending(message.requestId, pending.result);
      } else if (kind === "agent.aborted") {
        const error = agentError({ code: "AGENT_ABORTED", message: "Agent request stopped." });
        pending.streamQueue?.fail(error);
        this.rejectPending(message.requestId, error);
      } else if (kind === "agent.error") {
        const error = agentError(message.input);
        pending.streamQueue?.fail(error);
        this.rejectPending(message.requestId, error);
      } else {
        this.rejectPending(message.requestId, agentError({
          code: "PROTOCOL_ERROR",
          message: "The local Agent service sent an unexpected event.",
        }));
      }
    }

    resolvePending(requestId, value) {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pending.delete(requestId);
      pending.resolve(value);
    }

    rejectPending(requestId, error) {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pending.delete(requestId);
      pending.reject(error);
    }

    handleDisconnect(cause) {
      const runtimeMessage = root.chrome?.runtime?.lastError?.message;
      const error = cause || agentError({
        code: runtimeMessage?.includes("not found") ? "HOST_NOT_FOUND" : "HOST_DISCONNECTED",
        message: runtimeMessage || "The local Agent service disconnected.",
        retryable: true,
      });
      this.connected = false;
      this.sessionConfigSignature = null;
      this.lastError = error;
      this.port = null;
      for (const requestId of [...this.pending.keys()]) {
        const pending = this.pending.get(requestId);
        pending?.streamQueue?.fail(error);
        this.rejectPending(requestId, error);
      }
    }
  }

  const exported = { AgentGateway, HOST_NAME, PROTOCOL_VERSION };
  root.BlueprintAgent = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);
