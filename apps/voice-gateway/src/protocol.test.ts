import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealTicket } from "../../web/src/lib/companion/ticket.ts";

const harness = vi.hoisted(() => ({
  sockets: [] as any[],
  servers: [] as any[],
  http: [] as any[],
}));
vi.mock("node:http", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: {
      createServer: () => {
        const server = Object.assign(new EventEmitter(), { listen: vi.fn() });
        harness.http.push(server);
        return server;
      },
    },
  };
});
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    sent: any[] = [];
    closed = false;
    constructor(readonly url = "test-client") {
      super();
      this.readyState = url.startsWith("wss://") ? 0 : 1;
      harness.sockets.push(this);
    }
    emit(name: string | symbol, ...args: any[]) {
      if (name === "open") this.readyState = 1;
      return super.emit(name, ...args);
    }
    send(value: string) {
      this.sent.push(JSON.parse(value));
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      this.emit("close");
    }
    terminate() {
      this.close();
    }
  }
  class FakeServer extends EventEmitter {
    constructor() {
      super();
      harness.servers.push(this);
    }
  }
  return { WebSocket: FakeSocket, WebSocketServer: FakeServer };
});

const secret = "ca".repeat(32),
  origin = "http://127.0.0.1:3000";
const ids = {
  owner: "4cb65531-82e5-4b98-8cb4-97bd83eddd44",
  conversation: "b7aa5432-2697-4e24-94c1-c203a6df45ed",
  nonce: "ac387dad-fc96-4b5f-bacd-235424b0d9d0",
};
let bridgeEvents: any[],
  bridgeHandler: (event: any, signal?: AbortSignal) => Promise<any>;
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function ticket(nonce = ids.nonce) {
  const now = Date.now();
  return sealTicket(
    {
      ownerId: ids.owner,
      conversationId: ids.conversation,
      origin,
      accessToken: "test-user-access-token",
      nonce,
      issuedAt: now,
      expiresAt: now + 60_000,
    },
    secret,
  );
}
async function connect(nonce = ids.nonce, capabilities?: unknown) {
  const { WebSocket } = await import("ws");
  const client = new WebSocket("test-client") as any;
  harness.servers.at(-1).emit("connection", client, { headers: { origin } });
  client.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "authenticate", ticket: ticket(nonce), capabilities })),
  );
  await settle();
  const provider = harness.sockets.filter((socket) =>
    socket.url.startsWith("wss://"),
  ).at(-1);
  expect(provider).toBeDefined();
  provider.emit("open");
  provider.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "session.created" })),
  );
  await settle();
  return {
    client,
    provider,
    emit: async (event: any) => {
      provider.emit("message", Buffer.from(JSON.stringify(event)));
      await settle();
    },
  };
}
async function sendClient(client: any, event: unknown) {
  client.emit("message", Buffer.from(JSON.stringify(event)));
  await settle();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("COMPANION_GATEWAY_SECRET", secret);
  vi.stubEnv("VOLC_SPEECH_API_KEY", "test-no-provider-key");
  vi.stubEnv("COMPANION_WEB_ORIGIN", origin);
  harness.sockets.length = 0;
  harness.servers.length = 0;
  harness.http.length = 0;
  bridgeEvents = [];
  bridgeHandler = async (event) =>
    event.kind === "initialize"
      ? {
          messages: [],
          instructions: "test",
          tools: [],
          preferences: { value: { voice: "test-voice" } },
        }
      : { result: { ok: true } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const event = JSON.parse(String(init.body)).event;
      bridgeEvents.push(event);
      try {
        const result = await new Promise<any>((resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (init.signal?.aborted) {
            abort();
            return;
          }
          init.signal?.addEventListener("abort", abort, { once: true });
          bridgeHandler(event, init.signal ?? undefined)
            .then(resolve, reject)
            .finally(() => init.signal?.removeEventListener("abort", abort));
        });
        return Response.json({ ok: true, ...result });
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        return Response.json(
          { ok: false, code: "test_bridge_failure" },
          { status: 503 },
        );
      }
    }),
  );
  await import("./server.ts");
});
afterEach(async () => {
  for (const socket of harness.sockets) socket.close();
  await settle();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Seeduplex gateway lifecycle using isolated transport fixtures", () => {
  const avatarA = {
    revision: "8cb93a31-bf3f-4444-bb24-7cb53831f101",
    modelId: "vrm-a",
    controls: [{ kind: "expression", id: "happy", label: "开心" }],
  };
  const avatarB = {
    revision: "8cb93a31-bf3f-4444-bb24-7cb53831f102",
    modelId: "vrm-b",
    controls: [{ kind: "expression", id: "smile", label: "微笑" }],
  };
  it("initializes voice with the loaded model's validated capability snapshot", async () => {
    const original = bridgeHandler;
    bridgeHandler = async (event, signal) => {
      const result = await original(event, signal);
      return event.kind === "initialize" && event.capabilities
        ? { ...result, tools: [{ type: "function", name: "avatar_control", parameters: { enum: [event.capabilities.controls[0].id] } }] }
        : result;
    };
    const { provider } = await connect(ids.nonce, avatarA);
    expect(bridgeEvents.find((event) => event.kind === "initialize")?.capabilities).toEqual(avatarA);
    expect(provider.sent.find((event: any) => event.type === "session.create").session.tools)
      .toEqual([expect.objectContaining({ name: "avatar_control", parameters: { enum: ["happy"] } })]);
  });
  it("updates voice tools for a new model and ignores a late old snapshot", async () => {
    const old = deferred<any>();
    const original = bridgeHandler;
    bridgeHandler = async (event, signal) => {
      if (event.kind === "avatar_capabilities") {
        if (event.capabilities?.revision === avatarA.revision) return old.promise;
        return { tools: [{ name: "avatar_control", id: event.capabilities?.controls[0]?.id }], instructions: "new model" };
      }
      return original(event, signal);
    };
    const { client, provider } = await connect();
    await sendClient(client, { type: "avatar_capabilities", capabilities: avatarA });
    await sendClient(client, { type: "avatar_capabilities", capabilities: avatarB });
    old.resolve({ tools: [{ name: "avatar_control", id: "happy" }], instructions: "old model" });
    await settle();
    const updates = provider.sent.filter((event: any) => event.type === "session.update");
    expect(updates).toHaveLength(1);
    expect(updates[0].session.tools).toEqual([{ name: "avatar_control", id: "smile" }]);
    expect(updates[0].session.instructions).toBe("new model");
  });
  it("drops old-model cues when an in-flight avatar tool resolves after model replacement", async () => {
    const pending = deferred<any>();
    const original = bridgeHandler;
    bridgeHandler = async (event, signal) => {
      if (event.kind === "avatar_capabilities") return { tools: [], instructions: "model changed" };
      if (event.kind === "tool") return pending.promise;
      return original(event, signal);
    };
    const { client, provider, emit } = await connect(ids.nonce, avatarA);
    await emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "user-input", text: "微笑一下" });
    await emit({ type: "response.function_call_arguments.done", response_id: "r1", items: [{ call_id: "a1", name: "avatar_control", arguments: "{}" }] });
    expect(bridgeEvents.find((event) => event.kind === "tool")?.capabilities).toEqual(avatarA);
    await sendClient(client, { type: "avatar_capabilities", capabilities: avatarB });
    pending.resolve({ cue: { revision: avatarA.revision, kind: "expression", id: "happy" }, result: { ok: true } });
    await settle();
    expect(client.sent.filter((event: any) => event.type === "cue")).toHaveLength(0);
    const output = provider.sent.find((event: any) => event.type === "conversation.item.create" && event.items?.some((item: any) => item.call_id === "a1"));
    expect(JSON.parse(output.items[0].content[0].text)).toEqual({ ok: false, code: "avatar_changed" });
  });
  it("delivers a cue belonging to the active avatar", async () => {
    const original = bridgeHandler;
    const cue = { revision: avatarA.revision, kind: "expression", id: "happy", value: 0.8 };
    bridgeHandler = async (event, signal) => event.kind === "tool"
      ? { cue, result: { ok: true } } : original(event, signal);
    const { client, emit } = await connect(ids.nonce, avatarA);
    await emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "user-input", text: "笑一下" });
    await emit({ type: "response.function_call_arguments.done", response_id: "r1", items: [{ call_id: "a1", name: "avatar_control", arguments: "{}" }] });
    expect(client.sent.find((event: any) => event.type === "cue")?.cue).toEqual(cue);
  });
  it("clears provider avatar tools when no model is loaded", async () => {
    const original = bridgeHandler;
    bridgeHandler = async (event, signal) => event.kind === "avatar_capabilities"
      ? { tools: [], instructions: "no avatar" } : original(event, signal);
    const { client, provider } = await connect(ids.nonce, avatarA);
    await sendClient(client, { type: "avatar_capabilities", capabilities: null });
    const update = provider.sent.find((event: any) => event.type === "session.update");
    expect(update.session.tools).toEqual([]);
    expect(bridgeEvents.find((event) => event.kind === "avatar_capabilities")?.capabilities).toBeNull();
  });
  it("updates the catalog after initialization if the model changed while initialization was pending", async () => {
    const pending = deferred<any>();
    const original = bridgeHandler;
    bridgeHandler = async (event, signal) => {
      if (event.kind === "initialize") return pending.promise;
      if (event.kind === "avatar_capabilities") return { tools: [{ name: "avatar_control", id: event.capabilities.controls[0].id }], instructions: "current" };
      return original(event, signal);
    };
    const { WebSocket } = await import("ws");
    const client = new WebSocket("test-client") as any;
    harness.servers.at(-1).emit("connection", client, { headers: { origin } });
    client.emit("message", Buffer.from(JSON.stringify({ type: "authenticate", ticket: ticket(), capabilities: avatarA })));
    await settle();
    await sendClient(client, { type: "avatar_capabilities", capabilities: avatarB });
    pending.resolve({ messages: [], tools: [], instructions: "old", preferences: { value: { voice: "test" } } });
    await settle();
    const provider = harness.sockets.find((socket) => socket.url.startsWith("wss://"));
    provider.emit("open");
    provider.emit("message", Buffer.from(JSON.stringify({ type: "session.created" })));
    await settle();
    expect(provider.sent.find((event: any) => event.type === "session.update").session.tools)
      .toEqual([{ name: "avatar_control", id: "smile" }]);
  });
  it("retries the current catalog when a turn changes during catalog lookup", async () => {
    const pending = deferred<any>();
    const original = bridgeHandler;
    let requests = 0;
    bridgeHandler = async (event, signal) => {
      if (event.kind === "avatar_capabilities") {
        requests++;
        return requests === 1 ? pending.promise : { tools: [{ name: "current" }], instructions: "current" };
      }
      return original(event, signal);
    };
    const { client, provider, emit } = await connect();
    await sendClient(client, { type: "avatar_capabilities", capabilities: avatarA });
    await emit({ type: "conversation.item.input_audio_transcription.started", item_id: "turn-1" });
    pending.resolve({ tools: [{ name: "stale" }], instructions: "stale" });
    await settle();
    const updates = provider.sent.filter((event: any) => event.type === "session.update");
    expect(requests).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0].session.tools).toEqual([{ name: "current" }]);
  });
  it("renews at 40000 UTF-8 context bytes only after matching playback and durable checkpoint completion", async () => {
    const pendingCheckpoint = deferred<any>();
    const originalHandler = bridgeHandler;
    bridgeHandler = (event, signal) => event.kind === "checkpoint"
      ? pendingCheckpoint.promise
      : originalHandler(event, signal);
    const { client, provider, emit } = await connect();
    const close = vi.spyOn(client, "close");
    const initialBytes = provider.sent.reduce((total: number, event: any) => {
      const context = event.type === "session.create" ? event.session
        : event.type === "conversation.item.create" ? event.items : undefined;
      return total + (context === undefined ? 0 : Buffer.byteLength(JSON.stringify(context), "utf8"));
    }, 0);
    const availableBytes = 39999 - initialBytes;
    expect(availableBytes).toBeGreaterThan(0);
    const almostFull = "记".repeat(Math.floor(availableBytes / 3)) + "a".repeat(availableBytes % 3);
    expect(Buffer.byteLength(almostFull, "utf8") + initialBytes).toBe(39999);
    expect(almostFull.length).toBeLessThan(40000);
    await emit({ type: "response.output_text.delta", response_id: "almost-full", delta: almostFull });
    await emit({ type: "response.output_audio.done", response_id: "almost-full" });
    await sendClient(client, { type: "playback_done", epoch: 0 });
    expect(bridgeEvents.filter((event) => event.kind === "checkpoint")).toHaveLength(0);
    expect(close).not.toHaveBeenCalled();
    await emit({ type: "response.output_text.delta", response_id: "full", delta: "a" });
    await emit({ type: "response.output_audio.delta", response_id: "full", delta: "AQIDBA==" });
    expect(bridgeEvents.filter((event) => event.kind === "checkpoint")).toHaveLength(0);
    await emit({ type: "response.output_audio.done", response_id: "full" });
    expect(close).not.toHaveBeenCalled();
    await sendClient(client, { type: "playback_done", epoch: -1 });
    expect(bridgeEvents.filter((event) => event.kind === "checkpoint")).toHaveLength(0);
    await sendClient(client, { type: "playback_done", epoch: 0 });
    await sendClient(client, { type: "playback_done", epoch: 0 });
    expect(bridgeEvents.filter((event) => event.kind === "checkpoint")).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
    const checkpointIndex = bridgeEvents.findIndex((event) => event.kind === "checkpoint");
    const savedReplyIndex = bridgeEvents.map((event) => event.kind === "assistant").lastIndexOf(true);
    expect(savedReplyIndex).toBeGreaterThanOrEqual(0);
    expect(savedReplyIndex).toBeLessThan(checkpointIndex);
    pendingCheckpoint.resolve({});
    await settle();
    expect(close).toHaveBeenCalledWith(1012, "Renew bounded voice context");
    expect(client.closed).toBe(true);
  });

  it("postpones a checkpoint-triggered renewal when a new ASR turn begins before it finishes", async () => {
    const pendingCheckpoint = deferred<any>();
    const originalHandler = bridgeHandler;
    let checkpoints = 0;
    bridgeHandler = (event, signal) => event.kind === "checkpoint"
      ? ++checkpoints === 1 ? pendingCheckpoint.promise : Promise.resolve({})
      : originalHandler(event, signal);
    const { client, emit } = await connect();
    const close = vi.spyOn(client, "close");
    await emit({ type: "response.output_text.delta", response_id: "old", delta: "记".repeat(14000) });
    await emit({ type: "response.output_audio.done", response_id: "old" });
    await sendClient(client, { type: "playback_done", epoch: 0 });
    expect(checkpoints).toBe(1);
    await emit({ type: "conversation.item.input_audio_transcription.started", item_id: "next-input" });
    pendingCheckpoint.resolve({});
    await settle();
    expect(close).not.toHaveBeenCalled();
    await sendClient(client, { type: "playback_done", epoch: 1 });
    expect(checkpoints).toBe(1);
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "next-input", text: "继续下一步。",
    });
    await emit({ type: "response.output_text.delta", response_id: "new", delta: "接着拍三张照片。" });
    await emit({ type: "response.output_audio.done", response_id: "new" });
    await sendClient(client, { type: "playback_done", epoch: 0 });
    expect(close).not.toHaveBeenCalled();
    await sendClient(client, { type: "playback_done", epoch: 1 });
    expect(checkpoints).toBe(2);
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(1012, "Renew bounded voice context");
  });

  it("renews with the existing archive window even when checkpoint generation fails", async () => {
    const originalHandler = bridgeHandler;
    bridgeHandler = (event, signal) => event.kind === "checkpoint"
      ? Promise.reject(new Error("summary temporarily unavailable"))
      : originalHandler(event, signal);
    const { client, emit } = await connect();
    const close = vi.spyOn(client, "close");
    await emit({ type: "response.output_text.delta", response_id: "full", delta: "记".repeat(14000) });
    await emit({ type: "response.output_audio.done", response_id: "full" });
    expect(close).not.toHaveBeenCalled();
    await sendClient(client, { type: "playback_done", epoch: 0 });
    expect(bridgeEvents.filter((event) => event.kind === "checkpoint")).toHaveLength(1);
    expect(close).toHaveBeenCalledWith(1012, "Renew bounded voice context");
    expect(client.sent.filter((event: any) => event.type === "error")).toHaveLength(0);
  });

  it("waits for an in-flight tool before renewing at the next completed playback boundary", async () => {
    const { client, emit } = await connect();
    const pendingTool = deferred<any>();
    const originalHandler = bridgeHandler;
    bridgeHandler = (event, signal) => event.kind === "tool"
      ? pendingTool.promise : originalHandler(event, signal);
    const close = vi.spyOn(client, "close");
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input", text: "记".repeat(14000),
    });
    await emit({
      type: "response.function_call_arguments.done", response_id: "tool-reply",
      items: [{ call_id: "active-tool", name: "read_goals", arguments: "{}" }],
    });
    expect(bridgeEvents.filter((event) => event.kind === "tool")).toHaveLength(1);
    await sendClient(client, { type: "playback_done", epoch: 0 });
    expect(close).not.toHaveBeenCalled();
    expect(bridgeEvents.filter((event) => event.kind === "checkpoint")).toHaveLength(0);
    pendingTool.resolve({ result: { ok: true } });
    await settle();
    await emit({ type: "response.output_text.delta", response_id: "tool-reply", delta: "目标已读取。" });
    await emit({ type: "response.output_audio.done", response_id: "tool-reply" });
    expect(close).not.toHaveBeenCalled();
    await sendClient(client, { type: "playback_done", epoch: 0 });
    expect(bridgeEvents.filter((event) => event.kind === "checkpoint")).toHaveLength(1);
    expect(close).toHaveBeenCalledWith(1012, "Renew bounded voice context");
  });

  it("rehydrates a renewed session from summary and recent messages without executing late old-session tools", async () => {
    const originalHandler = bridgeHandler;
    let checkpointComplete = false;
    bridgeHandler = async (event, signal) => {
      if (event.kind === "checkpoint") {
        checkpointComplete = true;
        return {};
      }
      const result = await originalHandler(event, signal);
      return event.kind === "initialize" && checkpointComplete ? {
        ...result,
        instructions: "已有摘要：用户正在学习摄影。",
        messages: [
          { role: "user", text: "下一步做什么？" },
          { role: "assistant", text: "拍摄三张照片。" },
        ],
      } : result;
    };
    const previous = await connect();
    await previous.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "old-input", text: "请继续摄影计划。",
    });
    await previous.emit({ type: "response.output_text.delta", response_id: "old-reply", delta: "记".repeat(14000) });
    await previous.emit({ type: "response.output_audio.done", response_id: "old-reply" });
    await sendClient(previous.client, { type: "playback_done", epoch: 0 });
    expect(previous.client.closed).toBe(true);
    const current = await connect("ac387dad-fc96-4b5f-bacd-235424b0d9d1");
    expect(current.provider).not.toBe(previous.provider);
    expect(current.provider.sent.find((event: any) => event.type === "session.create")?.session.instructions)
      .toBe("已有摘要：用户正在学习摄影。");
    const history = current.provider.sent.find((event: any) => event.type === "conversation.item.create");
    expect(history.items.map((item: any) => item.content[0].text)).toEqual(["下一步做什么？", "拍摄三张照片。"]);
    await previous.emit({ type: "response.output_audio.delta", response_id: "old-reply", delta: "AQIDBA==" });
    await previous.emit({
      type: "response.function_call_arguments.done", response_id: "old-reply",
      items: [{ call_id: "late-closed-tool", name: "read_goals", arguments: "{}" }],
    });
    expect(current.client.sent.filter((event: any) => event.type === "audio")).toHaveLength(0);
    expect(current.provider.sent.some((event: any) => event.type === "input_audio_buffer.append")).toBe(false);
    expect(bridgeEvents.filter((event) => event.kind === "tool")).toHaveLength(0);
  });

  it("streams explicit text using the live-verified greeting protocol and one speech ID", async () => {
    const { client, provider } = await connect();
    const send = async (event: unknown) => {
      client.emit("message", Buffer.from(JSON.stringify(event)));
      await settle();
    };
    await send({ type: "text_begin" });
    await send({ type: "speak_append", text: "你好，" });
    await send({ type: "speak_append", text: "这是文字播报。" });
    await send({
      type: "text_end",
      user: "你好",
      assistant: "你好，这是文字播报。",
    });
    const speech = provider.sent.filter((e: any) =>
      e.type.startsWith("speech_text_buffer."),
    );
    expect(speech.map((e: any) => e.type)).toEqual([
      "speech_text_buffer.append",
      "speech_text_buffer.append",
      "speech_text_buffer.commit",
    ]);
    expect(speech[0].speech_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(speech.map((e: any) => e.speech_id)).size).toBe(1);
    expect(speech[0].text).toBe("你好，");
    expect(speech[1].text).toBe("这是文字播报。");
    expect(
      provider.sent.some((e: any) => e.type === "conversation.item.create"),
    ).toBe(true);
    await send({ type: "text_begin" });
    await send({ type: "speak_append", text: "新一轮" });
    expect(
      provider.sent
        .filter((e: any) => e.type === "speech_text_buffer.append")
        .at(-1).speech_id,
    ).not.toBe(speech[0].speech_id);
  });
  it("requires authentication before forwarding audio and rejects ticket replay", async () => {
    const { client } = await connect();
    expect(client.sent.some((event: any) => event.type === "ready")).toBe(true);
    const { WebSocket } = await import("ws"),
      replay = new WebSocket("test-client") as any;
    harness.servers[0].emit("connection", replay, { headers: { origin } });
    replay.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "authenticate", ticket: ticket() })),
    );
    await settle();
    expect(replay.closed).toBe(true);
    expect(
      harness.sockets.filter((socket) => socket.url.startsWith("wss://")),
    ).toHaveLength(1);
  });
  it("forwards PCM input and cancels the active response on explicit interruption", async () => {
    const { client, provider, emit } = await connect();
    client.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "audio", audio: "AQIDBA==" })),
    );
    await settle();
    expect(provider.sent).toContainEqual({
      type: "input_audio_buffer.append",
      audio: "AQIDBA==",
    });
    await emit({
      type: "response.output_audio.delta",
      response_id: "old",
      delta: "AQIDBA==",
    });
    client.emit("message", Buffer.from(JSON.stringify({ type: "interrupt" })));
    await settle();
    expect(
      provider.sent.some((event: any) => event.type === "response.cancel"),
    ).toBe(true);
    const audioCount = client.sent.filter(
      (event: any) => event.type === "audio",
    ).length;
    await emit({
      type: "response.output_audio.delta",
      response_id: "old",
      delta: "AQIDBA==",
    });
    expect(
      client.sent.filter((event: any) => event.type === "audio"),
    ).toHaveLength(audioCount);
  });
  it("blocks a response interrupted after audio starts but before its first text or audio chunk", async () => {
    const { client, emit } = await connect();
    await emit({ type: "response.output_audio.started", response_id: "not-yet-streamed" });
    client.emit("message", Buffer.from(JSON.stringify({ type: "interrupt" })));
    await settle();
    await emit({
      type: "response.output_audio.delta",
      response_id: "not-yet-streamed",
      delta: "AQIDBA==",
    });
    expect(
      client.sent.filter((event: any) => event.type === "audio"),
    ).toHaveLength(0);
    await emit({ type: "response.output_audio.started", response_id: "next-response" });
    await emit({
      type: "response.output_audio.delta",
      response_id: "next-response",
      delta: "BQYHCA==",
    });
    expect(
      client.sent.filter((event: any) => event.type === "audio"),
    ).toEqual([
      expect.objectContaining({ type: "audio", audio: "BQYHCA==" }),
    ]);
  });
  it("starts a new listening epoch without cancelling the provider's automatic response", async () => {
    const { client, provider, emit } = await connect();
    await emit({
      type: "conversation.item.input_audio_transcription.started",
      item_id: "input-item-1",
    });
    expect(
      provider.sent.filter((event: any) => event.type === "response.cancel"),
    ).toHaveLength(0);
    expect(
      client.sent.filter((event: any) => event.type === "listening"),
    ).toEqual([expect.objectContaining({ epoch: 1 })]);
  });
  it("does not reset the listening epoch again for a replayed transcription start", async () => {
    const { client, emit } = await connect();
    const started = {
      type: "conversation.item.input_audio_transcription.started",
      item_id: "input-item-1",
    };
    await emit(started);
    await emit(started);
    expect(
      client.sent.filter((event: any) => event.type === "listening"),
    ).toEqual([expect.objectContaining({ epoch: 1 })]);
  });
  it("accepts the provider input item ID when transcription started did not include one", async () => {
    const { client, emit } = await connect();
    await emit({ type: "conversation.item.input_audio_transcription.started" });
    await emit({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "real-input-item",
      text: "今天",
    });
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "real-input-item",
      transcript: "今天是几号",
    });
    expect(client.sent.filter((event: any) => event.type === "transcript")).toEqual([
      { type: "transcript", itemId: "real-input-item", text: "今天", epoch: 1 },
    ]);
    expect(
      bridgeEvents.filter((event) => event.kind === "user").map((event) => event.text),
    ).toEqual(["今天是几号"]);
    expect(client.sent.filter((event: any) => event.type === "user")).toEqual([
      expect.objectContaining({ itemId: "real-input-item", text: "今天是几号", epoch: 1 }),
    ]);
  });
  it("does not clear an active reply when the completed input's transcription start is replayed", async () => {
    const { client, emit } = await connect();
    const started = {
      type: "conversation.item.input_audio_transcription.started",
      item_id: "finished-input",
    };
    await emit(started);
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "finished-input",
      text: "今天是几号？",
    });
    await emit({
      type: "response.output_audio.started",
      response_id: "active-reply",
    });
    await emit({
      type: "response.output_text.delta",
      response_id: "active-reply",
      delta: "今天是十月二十五日。",
    });
    const interruptions = client.sent.filter((event: any) => event.type === "interrupted").length;
    await emit(started);
    await emit({
      type: "response.output_audio.delta",
      response_id: "active-reply",
      delta: "AQIDBA==",
    });
    await emit({ type: "response.output_audio.done", response_id: "active-reply" });
    expect(client.sent.filter((event: any) => event.type === "interrupted")).toHaveLength(interruptions);
    expect(client.sent.filter((event: any) => event.type === "audio")).toEqual([
      { type: "audio", audio: "AQIDBA==", epoch: 1 },
    ]);
    expect(
      bridgeEvents.filter((event) => event.kind === "assistant"),
    ).toEqual([
      expect.objectContaining({ text: "今天是十月二十五日。", interrupted: false }),
    ]);
  });
  it("forwards ASR snapshots with their input item and epoch and ignores late snapshots after completion", async () => {
    const { client, emit } = await connect();
    await emit({
      type: "conversation.item.input_audio_transcription.started",
      item_id: "input-item-1",
    });
    for (const text of ["我今天", "我今天想学摄影。"])
      await emit({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "input-item-1",
        text,
      });
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "input-item-1",
      text: "我今天想学摄影。",
    });
    await emit({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "input-item-1",
      text: "我今天想学摄影。",
    });
    expect(
      client.sent.filter((event: any) => event.type === "transcript"),
    ).toEqual([
      { type: "transcript", text: "我今天", itemId: "input-item-1", epoch: 1 },
      { type: "transcript", text: "我今天想学摄影。", itemId: "input-item-1", epoch: 1 },
    ]);
    await emit({
      type: "conversation.item.input_audio_transcription.started",
      item_id: "input-item-2",
    });
    await emit({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "input-item-1",
      text: "过期的第一轮字幕。",
    });
    await emit({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "input-item-2",
      text: "下一轮。",
    });
    expect(
      client.sent.filter((event: any) => event.type === "transcript").at(-1),
    ).toEqual({ type: "transcript", text: "下一轮。", itemId: "input-item-2", epoch: 2 });
    expect(
      client.sent.filter((event: any) => event.type === "transcript"),
    ).toHaveLength(3);
  });
  it("keeps the next response after a native ASR turn starts and discards all late old response output", async () => {
    const { client, provider, emit } = await connect();
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "old-input",
      text: "先查看目标。",
    });
    await emit({
      type: "response.output_audio.started",
      response_id: "old-response",
    });
    await emit({
      type: "response.output_text.delta",
      response_id: "old-response",
      delta: "旧回答未说完。",
    });
    await emit({
      type: "conversation.item.input_audio_transcription.started",
      item_id: "next-input",
    });
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "next-input",
      text: "换个话题。",
    });
    const outputStart = client.sent.length;
    await emit({
      type: "response.output_audio.started",
      response_id: "next-response",
    });
    await emit({
      type: "response.output_text.delta",
      response_id: "next-response",
      delta: "新的完整回答。",
    });
    await emit({
      type: "response.output_audio.delta",
      response_id: "next-response",
      delta: "BQYHCA==",
    });
    for (const oldEvent of [
      { type: "response.output_text.delta", delta: "迟到的旧文本。" },
      { type: "response.output_audio.delta", delta: "AQIDBA==" },
      { type: "response.output_audio.done" },
      {
        type: "response.function_call_arguments.done",
        items: [{ call_id: "late-old-tool", name: "read_goals", arguments: "{}" }],
      },
      { type: "response.done", usage: null },
    ])
      await emit({ ...oldEvent, response_id: "old-response" });
    expect(
      client.sent.slice(outputStart).filter((event: any) =>
        ["delta", "audio", "audio_done"].includes(event.type),
      ),
    ).toEqual([
      { type: "delta", text: "新的完整回答。", epoch: 1 },
      { type: "audio", audio: "BQYHCA==", epoch: 1 },
    ]);
    expect(
      provider.sent.filter((event: any) => event.type === "response.cancel"),
    ).toHaveLength(0);
    expect(bridgeEvents.filter((event) => event.kind === "tool")).toHaveLength(0);
    expect(
      bridgeEvents.filter((event) =>
        event.kind === "assistant" && event.text === "新的完整回答。",
      ),
    ).toHaveLength(0);
    await emit({
      type: "response.output_audio.done",
      response_id: "next-response",
    });
    expect(
      client.sent.slice(outputStart).filter((event: any) => event.type === "audio_done"),
    ).toEqual([{ type: "audio_done", epoch: 1 }]);
    expect(
      bridgeEvents.filter((event) =>
        event.kind === "assistant" && event.text === "新的完整回答。",
      ),
    ).toEqual([expect.objectContaining({ interrupted: false })]);
  });
  it("closes a connection when authenticated session initialization fails", async () => {
    bridgeHandler = async () => {
      throw new Error("database unavailable");
    };
    const { WebSocket } = await import("ws"),
      client = new WebSocket("test-client") as any;
    harness.servers[0].emit("connection", client, { headers: { origin } });
    client.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "authenticate", ticket: ticket() })),
    );
    await settle();
    expect(client.closed).toBe(true);
    expect(
      harness.sockets.filter((socket) => socket.url.startsWith("wss://")),
    ).toHaveLength(0);
  });
  it("stores a user transcript before executing its tool and deduplicates call IDs", async () => {
    const { provider, emit } = await connect();
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "看看我的目标",
    });
    const call = {
      type: "response.function_call_arguments.done",
      response_id: "r1",
      items: [{ call_id: "call-1", name: "read_goals", arguments: "{}" }],
    };
    await emit(call);
    await emit(call);
    const events = bridgeEvents.filter((event) =>
      ["user", "tool"].includes(event.kind),
    );
    expect(events.map((event) => event.kind)).toEqual(["user", "tool"]);
    expect(events[1].messageId).toBe(events[0].id);
    expect(
      provider.sent.some(
        (event: any) =>
          event.type === "conversation.item.create" &&
          event.items?.some((item: any) => item.call_id === "call-1"),
      ),
    ).toBe(true);
  });
  it("persists and displays a replayed final transcript only once for the same input item", async () => {
    const { client, emit } = await connect();
    const completed = {
      type: "conversation.item.input_audio_transcription.completed",
      event_id: "asr-final-1",
      item_id: "input-item-1",
      text: "我想先练习摄影。",
    };
    await emit(completed);
    await emit(completed);
    await emit({ ...completed, event_id: "asr-final-1-replayed" });
    expect(
      bridgeEvents.filter((event) => event.kind === "user"),
    ).toHaveLength(1);
    expect(
      client.sent.filter((event: any) => event.type === "user"),
    ).toHaveLength(1);
  });
  it("retains the same spoken text when it belongs to a different input item", async () => {
    const { client, emit } = await connect();
    for (const item of ["input-item-1", "input-item-2"]) {
      await emit({
        type: "conversation.item.input_audio_transcription.started",
        item_id: item,
      });
      await emit({
        type: "conversation.item.input_audio_transcription.completed",
        event_id: `${item}-final`,
        item_id: item,
        text: "再说一遍。",
      });
    }
    expect(
      bridgeEvents.filter((event) => event.kind === "user"),
    ).toHaveLength(2);
    expect(
      client.sent.filter((event: any) => event.type === "user"),
    ).toHaveLength(2);
  });
  it("retains consecutive finals with different event IDs when the provider omits input item IDs", async () => {
    const { client, emit } = await connect();
    for (const eventId of ["first-final", "next-final"])
      await emit({
        type: "conversation.item.input_audio_transcription.completed",
        event_id: eventId,
        text: "再说一遍。",
      });
    expect(
      bridgeEvents.filter((event) => event.kind === "user").map((event) => event.text),
    ).toEqual(["再说一遍。", "再说一遍。"]);
    const displayed = client.sent.filter((event: any) => event.type === "user");
    expect(displayed).toHaveLength(2);
    expect(displayed[0].id).not.toBe(displayed[1].id);
  });
  it("does not attribute a cancelled response's late tool call to the next user message", async () => {
    const { client, emit } = await connect();
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "old-input",
      text: "先看看我的目标。",
    });
    await emit({
      type: "response.output_text.delta",
      response_id: "old-response",
      delta: "正在查看。",
    });
    client.emit("message", Buffer.from(JSON.stringify({ type: "interrupt" })));
    await settle();
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "new-input",
      text: "不用了，先聊天。",
    });
    await emit({
      type: "response.function_call_arguments.done",
      response_id: "old-response",
      items: [{ call_id: "late-old-tool", name: "read_goals", arguments: "{}" }],
    });
    expect(
      bridgeEvents.filter((event) => event.kind === "tool"),
    ).toHaveLength(0);
  });
  it("does not execute a queued stale tool after the user has interrupted its turn", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridgeHandler = async (event) => {
      if (event.kind === "user") await blocked;
      return event.kind === "initialize"
        ? {
            messages: [],
            tools: [],
            instructions: "test",
            preferences: { value: { voice: "test" } },
          }
        : { result: { ok: true } };
    };
    const { client, emit } = await connect();
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "制定目标",
    });
    await emit({
      type: "response.function_call_arguments.done",
      items: [{ call_id: "old-tool", name: "draft_goal", arguments: "{}" }],
    });
    client.emit("message", Buffer.from(JSON.stringify({ type: "interrupt" })));
    release();
    await settle();
    expect(bridgeEvents.filter((event) => event.kind === "tool")).toHaveLength(
      0,
    );
  });
  it("resolves failed tool calls with a tool result instead of leaving the provider waiting", async () => {
    const { provider, emit } = await connect();
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "我的目标",
    });
    bridgeHandler = async (event) => {
      if (event.kind === "tool") throw new Error("offline");
      return {};
    };
    await emit({
      type: "response.function_call_arguments.done",
      items: [{ call_id: "failed-tool", name: "read_goals", arguments: "{}" }],
    });
    const result = provider.sent.find(
      (event: any) =>
        event.type === "conversation.item.create" &&
        event.items?.some((item: any) => item.call_id === "failed-tool"),
    );
    expect(result).toBeDefined();
    expect(JSON.stringify(result)).toContain("false");
  });
  it("aborts a slow old tool on interruption so the next user turn can be persisted promptly", async () => {
    const { client, emit } = await connect();
    let toolSignal: AbortSignal | undefined;
    bridgeHandler = async (event, signal) => {
      if (event.kind === "tool") {
        toolSignal = signal;
        return new Promise(() => {});
      }
      return {};
    };
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "先检查目标",
    });
    await emit({
      type: "response.function_call_arguments.done",
      items: [{ call_id: "slow-tool", name: "read_goals", arguments: "{}" }],
    });
    expect(toolSignal).toBeDefined();
    expect(toolSignal!.aborted).toBe(false);
    client.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "interrupt", requestId: "new-turn" })),
    );
    await settle();
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "改为记录今天的进展",
    });
    expect(toolSignal!.aborted).toBe(true);
    expect(
      bridgeEvents
        .filter((event) => event.kind === "user")
        .map((event) => event.text),
    ).toEqual(["先检查目标", "改为记录今天的进展"]);
    expect(client.sent).toContainEqual(
      expect.objectContaining({ type: "interrupted", requestId: "new-turn" }),
    );
  });
  it("aborts an in-flight tool bridge when the browser disconnects", async () => {
    const { client, emit } = await connect();
    let toolSignal: AbortSignal | undefined;
    bridgeHandler = async (event, signal) => {
      if (event.kind === "tool") {
        toolSignal = signal;
        return new Promise(() => {});
      }
      return {};
    };
    await emit({
      type: "conversation.item.input_audio_transcription.completed",
      text: "检查目标",
    });
    await emit({
      type: "response.function_call_arguments.done",
      items: [{ call_id: "closing-tool", name: "read_goals", arguments: "{}" }],
    });
    expect(toolSignal!.aborted).toBe(false);
    client.close();
    await settle();
    expect(toolSignal!.aborted).toBe(true);
  });
  it("ignores an old response audio-done event when the next response has already started", async () => {
    const { client, emit } = await connect();
    await emit({
      type: "response.output_text.delta",
      response_id: "old",
      delta: "旧回复",
    });
    client.emit("message", Buffer.from(JSON.stringify({ type: "interrupt" })));
    await settle();
    await emit({
      type: "response.output_text.delta",
      response_id: "new",
      delta: "新回复",
    });
    await emit({ type: "response.output_audio.done", response_id: "old" });
    expect(
      bridgeEvents.filter(
        (event) => event.kind === "assistant" && event.text === "新回复",
      ),
    ).toHaveLength(0);
    await emit({ type: "response.output_audio.done", response_id: "new" });
    expect(
      bridgeEvents.filter(
        (event) => event.kind === "assistant" && event.text === "新回复",
      ),
    ).toHaveLength(1);
  });
  it("preserves a fully played assistant message when the user starts the next normal turn", async () => {
    const { client, emit } = await connect();
    await emit({
      type: "response.output_text.delta",
      response_id: "finished",
      delta: "你的下一步是拍摄三张照片。",
    });
    await emit({ type: "response.output_audio.done", response_id: "finished" });
    client.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "playback_done", epoch: 0 })),
    );
    await settle();
    await emit({ type: "conversation.item.input_audio_transcription.started" });
    expect(
      bridgeEvents.filter((event) => event.kind === "interrupted"),
    ).toHaveLength(0);
    expect(
      bridgeEvents.find((event) => event.kind === "assistant")?.interrupted,
    ).toBe(false);
  });
});
