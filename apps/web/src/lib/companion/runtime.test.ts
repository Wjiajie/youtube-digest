import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionRuntime, type CompanionState } from "./runtime";
import { defaultPreferences } from "./contracts";

const sockets: FakeSocket[] = [],
  contexts: FakeAudioContext[] = [],
  worklets: FakeWorklet[] = [],
  audioSources: any[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    sockets.push(this);
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  event(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createGain() {
    return { ...node(), gain: { value: 1 } };
  }
  createAnalyser() {
    return {
      ...node(),
      fftSize: 512,
      getFloatTimeDomainData: (values: Float32Array) => values.fill(0),
    };
  }
  createMediaStreamSource() {
    return node();
  }
  createBuffer(_channels: number, count: number, rate: number) {
    return {
      duration: count / rate,
      getChannelData: () => new Float32Array(count),
    };
  }
  createBufferSource() {
    const source = {
      ...node(),
      onended: null,
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    audioSources.push(source);
    return source;
  }
}
class FakeWorklet {
  port = {
    onmessage: null as
      | ((event: { data: { pcm: ArrayBuffer; rms: number } }) => void)
      | null,
    close: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    worklets.push(this);
  }
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const bootstrap = {
  ticket: "test-encrypted-ticket",
  url: "ws://127.0.0.1:3191",
};
let runtimes: CompanionRuntime[];
function runtime() {
  const states: CompanionState[] = [],
    value = new CompanionRuntime(
      (state) => states.push(state),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      () => defaultPreferences,
    );
  runtimes.push(value);
  return { value, states, latest: () => states.at(-1)! };
}
beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
  contexts.length = 0;
  worklets.length = 0;
  audioSources.length = 0;
  runtimes = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorklet);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(bootstrap)),
  );
});
afterEach(() => {
  for (const value of runtimes) value.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("companion browser lifecycle without microphone or provider access", () => {
  it("does not ask for a microphone if voice was stopped while credentials were loading", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending.promise),
    );
    const { value, latest } = runtime(),
      start = value.startVoice();
    value.stopVoice();
    pending.resolve(Response.json(bootstrap));
    await start;
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(latest().voice).toBe(false);
    expect(sockets).toHaveLength(0);
  });
  it("stops late microphone tracks and never reopens voice after the user disabled it", async () => {
    const pending = deferred<any>(),
      stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
      pending.promise,
    );
    const { value, latest } = runtime(),
      start = value.startVoice();
    await settle();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    value.stopVoice();
    pending.resolve({ getTracks: () => [{ stop }] });
    await start;
    expect(stop).toHaveBeenCalledOnce();
    expect(latest().voice).toBe(false);
    expect(sockets).toHaveLength(0);
  });
  it("cleans up microphone permission that resolves after the runtime has been disposed", async () => {
    const pending = deferred<any>(),
      stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
      pending.promise,
    );
    const { value } = runtime(),
      start = value.startVoice();
    await settle();
    value.dispose();
    pending.resolve({ getTracks: () => [{ stop }] });
    await start;
    expect(stop).toHaveBeenCalledOnce();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].close).toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
  it("ignores events from a stopped socket after a replacement voice connection is active", async () => {
    const { value, states, latest } = runtime();
    await value.startVoice();
    const old = sockets[0];
    old.event({ type: "ready" });
    value.stopVoice();
    await value.startVoice();
    const active = sockets[1];
    active.event({ type: "ready" });
    const updates = states.length;
    old.event({ type: "error", code: "unavailable" });
    old.event({ type: "user", text: "stale" });
    old.onclose?.({ code: 1012 });
    expect(states).toHaveLength(updates);
    expect(latest().phase).toBe("listening");
    await vi.advanceTimersByTimeAsync(9000);
    expect(sockets).toHaveLength(2);
  });
  it("acknowledges heard audio only when playback has finished, rather than when generation ends", async () => {
    const { value } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    socket.event({ type: "audio_done", epoch: 0 });
    expect(audioSources).toHaveLength(1);
    expect(
      socket.sent.filter((event) => event.type === "playback_done"),
    ).toHaveLength(0);
    audioSources[0].onended?.();
    expect(
      socket.sent.filter((event) => event.type === "playback_done"),
    ).toMatchObject([{ type: "playback_done", epoch: 0 }]);
  });
  it("allows a normal reply to arrive faster than it plays without cancelling it at eight seconds", async () => {
    const { value } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    const tenSeconds = Buffer.alloc(24000 * 2 * 10).toString("base64");
    socket.event({ type: "audio", audio: tenSeconds, epoch: 0 });
    socket.event({ type: "audio", audio: tenSeconds, epoch: 0 });
    expect(audioSources).toHaveLength(2);
    expect(audioSources[0].stop).not.toHaveBeenCalled();
    expect(socket.sent.filter((e) => e.type === "interrupt")).toHaveLength(0);
  });
  it("does not cancel a reply when a short microphone noise burst occurs during playback", async () => {
    const { value } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    // The worklet emits 20 ms frames. A 60 ms RMS burst alone is not
    // provider-confirmed speech and must not cancel the generated response.
    for (let frame = 0; frame < 18; frame++) {
      worklets[0].port.onmessage?.({
        data: { pcm: new ArrayBuffer(640), rms: frame < 3 ? 0.05 : 0 },
      });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(socket.sent.filter((event) => event.type === "audio")).toHaveLength(18);
    expect(socket.sent.filter((event) => event.type === "interrupt")).toHaveLength(0);
  });
  it("stops the old playback queue on provider-confirmed listening and plays the new epoch", async () => {
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "delta", text: "上一轮回复", epoch: 0 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    socket.event({ type: "listening", epoch: 1 });
    expect(audioSources[0].stop).toHaveBeenCalledOnce();
    expect(audioSources[1].stop).toHaveBeenCalledOnce();
    expect(latest()).toMatchObject({ phase: "listening", subtitle: "" });
    expect(socket.sent.filter((event) => event.type === "interrupt")).toHaveLength(0);
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    expect(audioSources).toHaveLength(2);
    socket.event({ type: "user", id: "next-user", text: "新的问题", epoch: 1 });
    socket.event({ type: "delta", text: "新的回复", epoch: 1 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 1 });
    expect(audioSources).toHaveLength(3);
    expect(audioSources[2].start).toHaveBeenCalledOnce();
    expect(audioSources[2].stop).not.toHaveBeenCalled();
    expect(latest()).toMatchObject({ phase: "speaking", subtitle: "新的回复" });
  });
  it("keeps the reply speaking through a natural audio gap until provider completion", async () => {
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "delta", text: "第一句。", epoch: 0 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    audioSources[0].onended?.();
    await vi.advanceTimersByTimeAsync(400);
    expect(latest()).toMatchObject({ phase: "speaking", subtitle: "第一句。" });
    expect(socket.sent.filter((event) => event.type === "playback_done")).toHaveLength(0);
    socket.event({ type: "delta", text: "第二句。", epoch: 0 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    socket.event({ type: "audio_done", epoch: 0 });
    expect(latest().phase).toBe("speaking");
    audioSources[1].onended?.();
    expect(latest().phase).toBe("listening");
    expect(socket.sent.filter((event) => event.type === "playback_done")).toEqual([
      { type: "playback_done", epoch: 0 },
    ]);
  });
  it("keeps uploading sustained microphone energy without cancelling unconfirmed speech", async () => {
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    for (let frame = 0; frame < 50; frame++) {
      worklets[0].port.onmessage?.({
        data: { pcm: new ArrayBuffer(640), rms: 0.25 },
      });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(socket.sent.filter((event) => event.type === "audio")).toHaveLength(50);
    expect(socket.sent.filter((event) => event.type === "interrupt")).toHaveLength(0);
    expect(audioSources[0].stop).not.toHaveBeenCalled();
    expect(latest().phase).toBe("speaking");
  });
  it("does not abort a typed SSE reply when the microphone has sustained energy", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let textSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      if (JSON.parse(String(init.body)).operation === "voice")
        return Promise.resolve(Response.json(bootstrap));
      textSignal = init.signal;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          controller = stream;
          stream.enqueue(encoder.encode('data: {"type":"delta","text":"第一句。"}\n\n'));
        },
      }), { headers: { "Content-Type": "text/event-stream" } }));
    }));
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    const pending = value.sendText("继续讲讲");
    await settle();
    const interruption = socket.sent.findLast((event) => event.type === "interrupt");
    socket.event({ type: "interrupted", epoch: 1, requestId: interruption.requestId });
    expect(latest()).toMatchObject({ busy: true, subtitle: "第一句。" });
    const interrupts = socket.sent.filter((event) => event.type === "interrupt").length;
    for (let frame = 0; frame < 50; frame++) {
      worklets[0].port.onmessage?.({
        data: { pcm: new ArrayBuffer(640), rms: 0.25 },
      });
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(textSignal?.aborted).toBe(false);
    expect(socket.sent.filter((event) => event.type === "interrupt")).toHaveLength(interrupts);
    expect(socket.sent.filter((event) => event.type === "text_cancel")).toHaveLength(0);
    controller.enqueue(encoder.encode('data: {"type":"delta","text":"第二句。"}\n\ndata: {"type":"done","messages":[],"actions":[]}\n\n'));
    controller.close();
    await pending;
    expect(socket.sent.filter((event) => event.type === "text_end")).toEqual([
      { type: "text_end", user: "继续讲讲", assistant: "第一句。第二句。" },
    ]);
    expect(latest()).toMatchObject({ busy: false, subtitle: "第一句。第二句。", error: "" });
  });
  it("replaces repeated ASR snapshots for the same item instead of appending them", async () => {
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "listening", epoch: 0 });
    socket.event({ type: "transcript", text: "今天", itemId: "asr-1", epoch: 0 });
    expect(latest().subtitle).toBe("今天");
    socket.event({ type: "transcript", text: "今天是几号", itemId: "asr-1", epoch: 0 });
    expect(latest().subtitle).toBe("今天是几号");
    socket.event({ type: "transcript", text: "今天是几号", itemId: "asr-1", epoch: 0 });
    expect(latest().subtitle).toBe("今天是几号");
  });
  it.each([
    { type: "transcript", text: "旧转写", itemId: "old-asr", epoch: 0 },
    { type: "delta", text: "旧回复", epoch: 0 },
    { type: "listening", epoch: 0 },
  ])("ignores an old epoch $type event while a new reply is playing", async (event) => {
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "interrupted", epoch: 1 });
    socket.event({ type: "listening", epoch: 1 });
    socket.event({ type: "user", id: "new-user", text: "继续说明", epoch: 1 });
    socket.event({ type: "delta", text: "继续说明当前计划", epoch: 1 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 1 });
    expect(latest()).toMatchObject({ phase: "speaking", subtitle: "继续说明当前计划" });
    socket.event(event);
    expect(latest()).toMatchObject({ phase: "speaking", subtitle: "继续说明当前计划" });
    expect(audioSources[0].stop).not.toHaveBeenCalled();
  });
  it("does not let the previous reply caption timer erase a new user turn while thinking", async () => {
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "delta", text: "上一轮回复", epoch: 0 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    socket.event({ type: "audio_done", epoch: 0 });
    audioSources[0].onended?.();
    await vi.advanceTimersByTimeAsync(1000);
    socket.event({ type: "user", id: "next-user", text: "新的问题", epoch: 0 });
    expect(latest()).toMatchObject({ phase: "thinking", subtitle: "新的问题" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(latest()).toMatchObject({ phase: "thinking", subtitle: "新的问题" });
  });
  it("does not let an old interruption acknowledgement stop audio from the resumed epoch", async () => {
    const { value } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    value.interrupt();
    const requestId = socket.sent.findLast((event) => event.type === "interrupt").requestId;
    socket.event({ type: "interrupted", epoch: 1, requestId });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 1 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 1 });
    expect(audioSources[0].stop).toHaveBeenCalledOnce();
    socket.event({ type: "interrupted", epoch: 0, requestId: "older-request" });
    expect(audioSources[1].stop).not.toHaveBeenCalled();
    expect(audioSources[2].stop).not.toHaveBeenCalled();
  });
  it("does not treat an old epoch audio completion as completion of the active reply", async () => {
    const { value } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    value.interrupt();
    const requestId = socket.sent.findLast((event) => event.type === "interrupt").requestId;
    socket.event({ type: "interrupted", epoch: 1, requestId });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 1 });
    socket.event({ type: "audio_done", epoch: 0 });
    audioSources[1].onended?.();
    expect(socket.sent.filter((event) => event.type === "playback_done")).toHaveLength(0);
    socket.event({ type: "audio_done", epoch: 1 });
    expect(socket.sent.filter((event) => event.type === "playback_done")).toEqual([
      { type: "playback_done", epoch: 1 },
    ]);
  });
  it("blocks buffered old audio immediately and resumes only for the latest matching interrupt acknowledgement", async () => {
    const { value } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    expect(audioSources).toHaveLength(1);
    value.interrupt();
    const first = socket.sent
      .filter((event) => event.type === "interrupt")
      .at(-1).requestId;
    expect(audioSources[0].stop).toHaveBeenCalledOnce();
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    expect(audioSources).toHaveLength(1);
    value.interrupt();
    const latest = socket.sent
      .filter((event) => event.type === "interrupt")
      .at(-1).requestId;
    expect(latest).not.toBe(first);
    socket.event({ type: "interrupted", epoch: 1, requestId: first });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 1 });
    expect(audioSources).toHaveLength(1);
    socket.event({ type: "interrupted", epoch: 2 });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 2 });
    expect(audioSources).toHaveLength(1);
    socket.event({ type: "interrupted", epoch: 2, requestId: latest });
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 0 });
    expect(audioSources).toHaveLength(1);
    socket.event({ type: "audio", audio: "AAAAAA==", epoch: 2 });
    expect(audioSources).toHaveLength(2);
  });
  it("an old text turn cannot commit or unmute a newer text turn", async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    let textRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        const operation = JSON.parse(String(init.body)).operation;
        return operation === "voice"
          ? Promise.resolve(Response.json(bootstrap))
          : ++textRequests === 1
            ? first.promise
            : second.promise;
      }),
    );
    const { value } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    const old = value.sendText("第一轮");
    await settle();
    const active = value.sendText("第二轮");
    await settle();
    expect(textRequests).toBe(2);
    expect(
      socket.sent.filter((event) => event.type === "text_begin"),
    ).toHaveLength(2);
    first.resolve(
      new Response("", { headers: { "Content-Type": "text/event-stream" } }),
    );
    await old;
    expect(
      socket.sent.filter((event) => event.type === "text_end"),
    ).toHaveLength(0);
    second.resolve(
      new Response(
        'data: {"type":"delta","text":"第二轮回复"}\n\ndata: {"type":"done","messages":[],"actions":[]}\n\n',
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
    );
    await active;
    expect(socket.sent.filter((event) => event.type === "text_end")).toEqual([
      { type: "text_end", user: "第二轮", assistant: "第二轮回复" },
    ]);
  });
  it("never injects an interrupted partial text reply as a complete voice QA pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        if (JSON.parse(String(init.body)).operation === "voice")
          return Promise.resolve(Response.json(bootstrap));
        return Promise.resolve(
          new Response(
            'data: {"type":"delta","text":"未完成片段"}\n\ndata: {"type":"error","code":"provider_unavailable"}\n\n',
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          ),
        );
      }),
    );
    const { value, latest } = runtime();
    await value.startVoice();
    const socket = sockets[0];
    socket.event({ type: "ready" });
    await value.sendText("下一步呢");
    expect(
      socket.sent.filter((event) => event.type === "text_end"),
    ).toHaveLength(0);
    expect(
      socket.sent.filter((event) => event.type === "text_cancel"),
    ).toHaveLength(1);
    expect(latest().error).toContain("回复暂时中断");
  });
});
