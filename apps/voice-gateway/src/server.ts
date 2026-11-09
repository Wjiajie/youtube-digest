import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  openTicket,
  bridgeSignature,
} from "../../web/src/lib/companion/ticket.ts";
import { recentContext } from "../../web/src/lib/companion/history.ts";
import { contextBytes } from "../../web/src/lib/companion/context-budget.ts";
import { normalizeAvatarCapabilities } from "../../web/src/lib/companion/avatar-capabilities.ts";

const secret = process.env.COMPANION_GATEWAY_SECRET ?? "",
  apiKey = process.env.VOLC_SPEECH_API_KEY;
const webOrigin = process.env.COMPANION_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const port = Number(process.env.COMPANION_GATEWAY_PORT ?? 3191);
const used = new Map<string, number>();
const server = http.createServer((_, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(
    JSON.stringify({
      service: "blueprint-voice-gateway",
      configured: !!apiKey && secret.length === 64,
    }),
  );
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/" || req.headers.origin !== webOrigin) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (downstream, req) => {
  let upstream: WebSocket | undefined,
    authenticated = false,
    ticket = "",
    closing = false,
    epoch = 0,
    messageId = "",
    responseId = "",
    assistant = "",
    assistantId = "",
    lastAssistantId = "",
    textMode = false,
    speechId = "",
    inputItemId = "",
    inputTranscript = "",
    inputOpen = false,
    inputFinished = false;
  let contextUsed = 0, refreshDue = false, refreshing = false;
  let bridgeQueue = Promise.resolve(),
    ready = false;
  let confirmationPending = false;
  let pendingActionId: string | null = null;
  let capabilities: ReturnType<typeof normalizeAvatarCapabilities> = null;
  let capabilityVersion = 0;
  let initializedCapabilityVersion = 0;
  const blocked = new Set<string>(),
    completedInputs = new Set<string>(),
    calls = new Map<string, Promise<any>>(),
    timers = new Set<ReturnType<typeof setTimeout>>();
  const toolRequests = new Set<AbortController>();
  const pendingAudio: Array<Record<string, unknown>> = [];
  const send = (value: unknown) => {
    if (downstream.readyState === WebSocket.OPEN)
      downstream.send(JSON.stringify(value));
  };
  const accountContext = (text: string) => {
    contextUsed += contextBytes(text);
    if (contextUsed >= 40000) refreshDue = true;
  };
  const provider = (value: unknown) => {
    const event = value as Record<string, any>;
    if (event.type === "session.create") accountContext(JSON.stringify(event.session));
    if (event.type === "conversation.item.create") accountContext(JSON.stringify(event.items));
    if (upstream?.readyState === WebSocket.OPEN)
      upstream.send(
        JSON.stringify(
          (value as Record<string, unknown>).type ===
            "input_audio_buffer.append"
            ? value
            : {
                event_id: crypto.randomUUID(),
                ...(value as Record<string, unknown>),
              },
        ),
      );
  };
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const bridge = async (
    event: Record<string, unknown>,
    signal?: AbortSignal,
  ) => {
    const body = JSON.stringify({ operation: "bridge", ticket, event });
    const res = await fetch(`${webOrigin}/api/companion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-companion-signature": bridgeSignature(body, secret),
      },
      body,
      signal: AbortSignal.any([
        AbortSignal.timeout(event.kind === "tool" ? 85_000 : event.kind === "checkpoint" ? 85_000 : 12_000),
        ...(signal ? [signal] : []),
      ]),
    });
    const result = (await res.json()) as any;
    if (!res.ok || !result.ok)
      throw new Error(result.code ?? "bridge_unavailable");
    return result;
  };
  function syncCapabilities() {
    if (!ready || closing) return;
    const version = capabilityVersion;
    const syncEpoch = epoch;
    const snapshot = capabilities;
    void bridge({ kind: "avatar_capabilities", capabilities: snapshot })
      .then((result) => {
        if (closing || version !== capabilityVersion) return;
        // A turn transition invalidates in-flight work; retry the current
        // catalog so it is not lost when a user starts speaking meanwhile.
        if (syncEpoch !== epoch) {
          syncCapabilities();
          return;
        }
        if (!Array.isArray(result.tools) || typeof result.instructions !== "string")
          throw new Error("invalid_avatar_capabilities");
        provider({ type: "session.update", session: {
          tools: result.tools,
          instructions: result.instructions,
        } });
      })
      .catch(() => {
        if (!closing && version === capabilityVersion)
          send({ type: "error", code: "storage_or_tool_unavailable" });
      });
  }
  function enqueue(work: () => Promise<void>) {
    bridgeQueue = bridgeQueue
      .then(work)
      .catch(() =>
        send({ type: "error", code: "storage_or_tool_unavailable" }),
      );
  }
  function refreshAtBoundary() {
    if (!refreshDue || refreshing || inputOpen || textMode || confirmationPending || toolRequests.size) return;
    const boundaryEpoch = epoch;
    refreshing = true;
    enqueue(async () => {
      try {
        // Finish the durable summary before rehydrating a fresh provider
        // context. A new user turn postpones renewal until its own boundary.
        await bridge({ kind: "checkpoint" });
      } catch {
        // The archive/recent window is still usable if summarization failed.
      } finally {
        refreshing = false;
      }
      if (!closing && boundaryEpoch === epoch && !inputOpen && !textMode)
        downstream.close(1012, "Renew bounded voice context");
    });
  }
  function finishAssistant(interrupted = false) {
    if (!assistant.trim()) return;
    const text = assistant,
      id = assistantId || crypto.randomUUID();
    assistant = "";
    assistantId = "";
    lastAssistantId = id;
    enqueue(async () => {
      await bridge({ kind: "assistant", id, text, interrupted });
      send({ type: "refresh" });
    });
  }
  function interrupt(requestId?: string, cancelProvider = true) {
    confirmationPending = false;
    for (const request of toolRequests) request.abort();
    toolRequests.clear();
    if (responseId) blocked.add(responseId);
    responseId = "";
    epoch++;
    // Native ASR already owns turn detection. Cancelling again when its first
    // word arrives can race with and cancel the new automatic response.
    if (cancelProvider)
      provider({ type: "response.cancel", event_id: crypto.randomUUID() });
    finishAssistant(true);
    if (lastAssistantId) {
      const id = lastAssistantId;
      enqueue(async () => {
        await bridge({ kind: "interrupted", id });
      });
      lastAssistantId = "";
    }
    send({ type: "interrupted", epoch, requestId });
  }
  function close() {
    if (closing) return;
    closing = true;
    for (const request of toolRequests) request.abort();
    toolRequests.clear();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    finishAssistant(true);
    if (lastAssistantId) {
      const id = lastAssistantId;
      lastAssistantId = "";
      enqueue(async () => {
        await bridge({ kind: "interrupted", id });
      });
    }
    if (upstream?.readyState === WebSocket.OPEN) {
      provider({ type: "session.close", event_id: crypto.randomUUID() });
      setTimeout(() => upstream?.terminate(), 1500).unref();
    } else upstream?.terminate();
  }
  later(() => {
    if (!authenticated) downstream.close(1008, "Authentication required");
  }, 5000);
  downstream.on("close", close);
  downstream.on("error", close);
  downstream.on("message", async (bytes) => {
    if (closing) return;
    try {
      const event = JSON.parse(bytes.toString());
      if (!authenticated) {
        if (
          event.type !== "authenticate" ||
          typeof event.ticket !== "string" ||
          !apiKey
        )
          throw new Error("not_configured");
        const now = Date.now(),
          claim = openTicket(event.ticket, secret, now);
        for (const [nonce, expires] of used)
          if (expires < now) used.delete(nonce);
        if (
          claim.origin !== req.headers.origin ||
          claim.origin !== webOrigin ||
          now - claim.issuedAt > 60_000 ||
          used.has(claim.nonce)
        )
          throw new Error("invalid_ticket");
        used.set(claim.nonce, claim.expiresAt);
        ticket = event.ticket;
        authenticated = true;
        capabilities = normalizeAvatarCapabilities(event.capabilities);
        initializedCapabilityVersion = capabilityVersion;
        later(() => {
          if (!ready) {
            send({ type: "error", code: "voice_connection_failed" });
            downstream.close(1011, "Session initialization timed out");
          }
        }, 15000);
        const init = await bridge({ kind: "initialize", capabilities });
        if (closing) return;
        upstream = new WebSocket(
          "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue",
          { headers: { "X-Api-Key": apiKey }, maxPayload: 4 * 1024 * 1024 },
        );
        upstream.on("open", () => {
          const history = recentContext(init.messages, 10000);
          const pairs: Array<{ role: string; text: string }> = [];
          for (let i = 0; i < history.length - 1; i++)
            if (
              history[i].role === "user" &&
              history[i + 1].role === "assistant"
            ) {
              pairs.push(
                { role: "user", text: history[i].content },
                { role: "assistant", text: history[++i].content },
              );
            }
          provider({
            type: "session.create",
            event_id: crypto.randomUUID(),
            session: {
              id: crypto.randomUUID(),
              model: "1.2.6.1",
              instructions: init.instructions,
              tools: init.tools,
              audio: {
                input: { format: { type: "pcm", rate: 16000 } },
                output: {
                  format: { type: "pcm_s16le", rate: 24000 },
                  voice: init.preferences.value.voice,
                  speed: 0,
                  loudness: 0,
                },
              },
            },
          });
          if (pairs.length)
            provider({
              type: "conversation.item.create",
              items: pairs.slice(-20).map((p) => ({
                id: crypto.randomUUID(),
                type: "message",
                role: p.role,
                content: [{ type: "input_text", text: p.text.slice(0, 3000) }],
              })),
            });
        });
        upstream.on("message", (data) => {
          if (closing) return;
          try {
            const e = JSON.parse(data.toString());
            const itemId = typeof e.item_id === "string" ? e.item_id : "";
            const transcript = () =>
              [e.text, e.transcript, e.delta, e.results?.[0]?.text].find(
                (value) => typeof value === "string",
              ) ?? "";
            // A cancelled response may still deliver queued text, audio or
            // tool events. None of them belongs to a later user's message.
            if (e.type?.startsWith("response.") &&
              e.type !== "response.done" && blocked.has(e.response_id)) return;
            if (e.type === "session.created") {
              ready = true;
              if (initializedCapabilityVersion !== capabilityVersion)
                syncCapabilities();
              for (const audio of pendingAudio) provider(audio);
              pendingAudio.length = 0;
              send({ type: "ready", epoch });
            }
            if (
              e.type === "conversation.item.input_audio_transcription.started"
            ) {
              if (textMode) return;
              if (itemId &&
                (itemId === inputItemId || completedInputs.has(itemId))) return;
              if (!itemId && inputOpen) return;
              inputItemId = itemId;
              inputTranscript = "";
              inputOpen = true;
              inputFinished = false;
              interrupt(undefined, false);
              messageId = "";
              send({ type: "listening", itemId: inputItemId || undefined, epoch });
            }
            if (e.type === "conversation.item.input_audio_transcription.delta") {
              if (textMode || inputFinished ||
                (itemId && completedInputs.has(itemId)) ||
                (itemId && inputItemId && itemId !== inputItemId)) return;
              if (!inputItemId) inputItemId = itemId;
              inputOpen = true;
              inputTranscript = transcript();
              // Seeduplex ASR hypotheses replace the current question (the
              // official Web demo uses setQuestion even for *.delta).
              send({
                type: "transcript",
                text: inputTranscript,
                itemId: inputItemId,
                epoch,
              });
            }
            if (
              e.type === "conversation.item.input_audio_transcription.completed"
            ) {
              if (textMode) return;
              const key = itemId || e.event_id ||
                (inputOpen ? inputItemId : "") || crypto.randomUUID();
              if (completedInputs.has(key) ||
                (itemId && inputOpen && inputItemId && itemId !== inputItemId)) return;
              const text = transcript() || inputTranscript;
              if (!text.trim()) return;
              accountContext(text);
              completedInputs.add(key);
              if (completedInputs.size > 512)
                completedInputs.delete(completedInputs.values().next().value!);
              inputItemId = key;
              inputOpen = false;
              inputFinished = true;
              const confirm =
                /^(确认|确认保存|确认采纳|确认完成|保存|采纳)[。！!\s]*$/.test(
                  text.trim(),
                );
              if (confirm) {
                interrupt();
                confirmationPending = true;
              }
              const confirmationEpoch = epoch;
              messageId = crypto.randomUUID();
              const id = messageId;
              const actionId = pendingActionId;
              enqueue(async () => {
                try {
                  const result = await bridge({
                    kind: "user",
                    id,
                    text,
                    actionId,
                  });
                  if (confirm && confirmationEpoch === epoch) {
                    provider({
                      type: "speech_text_buffer.commit",
                      speech_id: crypto.randomUUID(),
                      text: result.confirmed
                        ? (result.message ?? "已保存。我们可以继续下一步。")
                        : "当前没有待确认的内容。",
                    });
                  }
                  send({ type: "refresh" });
                } catch {
                  if (confirm && confirmationEpoch === epoch)
                    provider({
                      type: "speech_text_buffer.commit",
                      speech_id: crypto.randomUUID(),
                      text: "还没有保存成功，请检查确认卡后重试。",
                    });
                  else if (!confirm) throw new Error("storage_unavailable");
                } finally {
                  if (confirmationEpoch === epoch) confirmationPending = false;
                }
              });
              send({ type: "user", id, itemId: inputItemId, text, epoch });
            }
            if (e.type === "response.output_audio.started" &&
              !confirmationPending) {
              if (e.response_id) responseId = e.response_id;
              send({ type: "responding", epoch });
            }
            if (
              e.type === "response.output_text.delta" &&
              !textMode &&
              !confirmationPending &&
              !blocked.has(e.response_id)
            ) {
              if (e.response_id) responseId = e.response_id;
              if (!assistantId) assistantId = crypto.randomUUID();
              const text = e.delta ?? e.text ?? "";
              accountContext(text);
              assistant += text;
              send({ type: "delta", text, epoch });
            }
            if (
              e.type === "response.output_audio.delta" &&
              !confirmationPending &&
              !blocked.has(e.response_id)
            ) {
              if (e.response_id) responseId = e.response_id;
              send({ type: "audio", audio: e.delta, epoch });
            }
            if (e.type === "response.function_call_arguments.done") {
              if (textMode) return;
              if (e.response_id) responseId = e.response_id;
              const callEpoch = epoch,
                userMessageId = messageId,
                callCapabilities = capabilities,
                callCapabilityVersion = capabilityVersion;
              enqueue(async () => {
                if (!userMessageId) return;
                if (closing || callEpoch !== epoch || confirmationPending) return;
                const results = await Promise.all(
                  (e.items ?? []).slice(0, 8).map(async (item: any) => {
                    let output: unknown;
                    try {
                      if (
                        typeof item.call_id !== "string" ||
                        typeof item.name !== "string" ||
                        typeof item.arguments !== "string" ||
                        item.arguments.length > 32000
                      )
                        throw new Error("invalid_tool_call");
                      if (item.name === "avatar_control" && callCapabilityVersion !== capabilityVersion)
                        throw new Error("avatar_changed");
                      let job = calls.get(item.call_id);
                      if (!job) {
                        const request = new AbortController();
                        toolRequests.add(request);
                        const started = performance.now();
                        job = bridge(
                          {
                            kind: "tool",
                            messageId: userMessageId,
                            name: item.name,
                            arguments: JSON.parse(item.arguments),
                            callId: `voice:${item.call_id}`,
                            capabilities: callCapabilities,
                          },
                          request.signal,
                        ).finally(() => {
                          toolRequests.delete(request);
                          send({
                            type: "tool_metric",
                            ms: performance.now() - started,
                            epoch: callEpoch,
                          });
                        });
                        calls.set(item.call_id, job);
                      }
                      const result = await job;
                      const avatarChanged = callCapabilityVersion !== capabilityVersion;
                      if (result.cue && callEpoch === epoch && !avatarChanged)
                        send({ type: "cue", cue: result.cue, epoch });
                      output = avatarChanged && item.name === "avatar_control"
                        ? { ok: false, code: "avatar_changed" }
                        : result.result;
                    } catch (error) {
                      output = { ok: false, code: error instanceof Error && error.message === "avatar_changed"
                        ? "avatar_changed" : "tool_unavailable" };
                    }
                    return {
                      call_id: item.call_id,
                      role: "tool",
                      content: [
                        { type: "input_text", text: JSON.stringify(output) },
                      ],
                    };
                  }),
                );
                // Even a cancelled response must resolve its tool IDs; it must not start new work.
                if (callEpoch === epoch)
                  provider({
                    type: "conversation.item.create",
                    items: results,
                  });
                send({ type: "refresh" });
              });
            }
            if (
              e.type === "response.output_audio.done" &&
              !blocked.has(e.response_id) &&
              (!e.response_id || !responseId || e.response_id === responseId)
            ) {
              finishAssistant();
              send({ type: "audio_done", epoch });
            }
            if (e.type === "response.done")
              send({ type: "usage", usage: e.usage ?? null });
            if (e.type === "session.closed") {
              upstream?.close();
              if (!closing) downstream.close(1012, "Session ended");
            }
            if (e.type === "error") {
              send({ type: "error", code: "voice_provider_error" });
              const code = String(
                e.error?.code ?? e.status_code ?? e.code ?? "",
              );
              downstream.close(
                /^4|auth|invalid/i.test(code) ? 1008 : 1011,
                "Voice service error",
              );
            }
          } catch {
            send({ type: "error", code: "invalid_provider_event" });
          }
        });
        upstream.on("error", () => {
          send({ type: "error", code: "voice_connection_failed" });
          downstream.close(1011);
        });
        upstream.on("close", () => {
          if (!closing) downstream.close(1012, "Reconnect voice");
        });
        later(
          () => downstream.close(1012, "Refresh authenticated session"),
          Math.max(1000, claim.expiresAt - Date.now() - 5000),
        );
        return;
      }
      if (event.type === "avatar_capabilities") {
        const next = normalizeAvatarCapabilities(event.capabilities);
        if (JSON.stringify(next) !== JSON.stringify(capabilities)) {
          capabilities = next;
          capabilityVersion++;
          syncCapabilities();
        }
      } else if (event.type === "audio" && !textMode) {
        if (typeof event.audio !== "string" || event.audio.length > 1800)
          throw new Error("invalid_audio");
        const chunk = { type: "input_audio_buffer.append", audio: event.audio };
        if (ready) provider(chunk);
        else if (pendingAudio.length < 100) pendingAudio.push(chunk);
      } else if (event.type === "pending_action") {
        pendingActionId =
          typeof event.id === "string" &&
          /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(event.id)
            ? event.id
            : null;
      } else if (event.type === "interrupt")
        interrupt(
          typeof event.requestId === "string"
            ? event.requestId.slice(0, 100)
            : undefined,
        );
      else if (event.type === "playback_done" && event.epoch === epoch) {
        lastAssistantId = "";
        refreshAtBoundary();
      }
      else if (event.type === "text_begin") {
        interrupt();
        inputOpen = false;
        textMode = true;
        speechId = crypto.randomUUID();
      } else if (event.type === "text_cancel" && textMode) {
        textMode = false;
      } else if (
        event.type === "speak_append" &&
        textMode &&
        typeof event.text === "string" &&
        event.text.length <= 16000
      )
        provider({
          type: "speech_text_buffer.append",
          speech_id: speechId,
          text: event.text,
        });
      else if (event.type === "text_end" && textMode) {
        provider({
          type: "speech_text_buffer.commit",
          speech_id: speechId,
          text: "",
        });
        if (
          typeof event.user === "string" &&
          typeof event.assistant === "string" &&
          event.user.length <= 8000 &&
          event.assistant.length <= 16000 &&
          event.assistant.trim()
        )
          provider({
            type: "conversation.item.create",
            items: [
              {
                id: crypto.randomUUID(),
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: event.user }],
              },
              {
                id: crypto.randomUUID(),
                type: "message",
                role: "assistant",
                content: [{ type: "input_text", text: event.assistant }],
              },
            ],
          });
        textMode = false;
      } else if (event.type === "stop") {
        close();
        later(() => downstream.close(), 1500);
      }
    } catch {
      send({
        type: "error",
        code: !authenticated
          ? "voice_authentication_failed"
          : !ready
            ? "voice_connection_failed"
            : "invalid_client_event",
      });
      if (!authenticated) downstream.close(1008);
      else if (!ready) downstream.close(1011);
    }
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Blueprint voice gateway: http://127.0.0.1:${port} (configured: ${!!apiKey && secret.length === 64})`,
  ),
);
