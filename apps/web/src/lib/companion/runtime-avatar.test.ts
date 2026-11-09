import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionRuntime } from "./runtime";
import { defaultPreferences } from "./contracts";

const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  constructor(readonly url: string) { sockets.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  event(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
class FakeAudioContext {
  destination = {};
  currentTime = 0;
  audioWorklet = { addModule: vi.fn(async () => {}) };
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createGain() { return { ...node(), gain: { value: 1 } }; }
  createAnalyser() { return { ...node(), fftSize: 512, getFloatTimeDomainData: vi.fn() }; }
  createMediaStreamSource() { return node(); }
}
class FakeWorklet { port = { onmessage: null, close: vi.fn() }; connect = vi.fn(); disconnect = vi.fn(); }
const first = {
  revision: "ac387dad-fc96-4b5f-bacd-235424b0d9d0",
  modelId: "first-vrm",
  controls: [{ kind: "expression" as const, id: "happy", label: "开心" }],
};
const second = {
  revision: "e7e86486-c39f-48ff-ac5e-bb43d58cf5e0",
  modelId: "second-vrm",
  controls: [{ kind: "expression" as const, id: "curious", label: "好奇" }],
};
let runtimes: CompanionRuntime[], requests: any[];
function runtime() {
  const cue = vi.fn();
  const value = new CompanionRuntime(vi.fn(), cue, vi.fn(), vi.fn(), () => defaultPreferences);
  runtimes.push(value);
  return { value, cue };
}
beforeEach(() => {
  sockets.length = 0;
  requests = [];
  runtimes = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorklet);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    if (body.operation === "voice") return Response.json({ ticket: "fixture", url: "ws://127.0.0.1:3191" });
    if (body.operation === "text") return new Response('data: {"type":"done","messages":[],"actions":[]}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    return Response.json({ messages: [], actions: [], preferences: { value: defaultPreferences }, conversationId: "fixture", textConfigured: true, voiceConfigured: true });
  }));
});
afterEach(() => {
  for (const value of runtimes) value.dispose();
  vi.unstubAllGlobals();
});

describe("runtime model capability and turn isolation", () => {
  it("includes the current capability snapshot in the text request", async () => {
    const { value } = runtime();
    value.setAvatarCapabilities(first);
    await value.sendText("请开心地回应我");
    const request = requests.find((item) => item.operation === "text");
    expect(request.capabilities).toEqual(first);
  });

  it("authenticates voice with the current snapshot and sends updates on model switch and unload", async () => {
    const { value } = runtime();
    value.setAvatarCapabilities(first);
    await value.startVoice();
    sockets[0].onopen?.();
    expect(sockets[0].sent).toContainEqual(expect.objectContaining({ type: "authenticate", capabilities: first }));
    sockets[0].event({ type: "ready", epoch: 0 });
    value.setAvatarCapabilities(second);
    expect(sockets[0].sent).toContainEqual(expect.objectContaining({ type: "avatar_capabilities", capabilities: second }));
    value.setAvatarCapabilities(null);
    expect(sockets[0].sent).toContainEqual(expect.objectContaining({ type: "avatar_capabilities", capabilities: null }));
  });

  it("suppresses stale model and turn cues without blocking a current advertised cue", async () => {
    const { value, cue } = runtime();
    value.setAvatarCapabilities(first);
    await value.startVoice();
    sockets[0].onopen?.();
    sockets[0].event({ type: "ready", epoch: 0 });
    sockets[0].event({ type: "cue", epoch: 0, cue: { revision: first.revision, kind: "expression", id: "happy", value: 0.5 } });
    expect(cue).toHaveBeenCalledTimes(1);
    value.setAvatarCapabilities(second);
    sockets[0].event({ type: "cue", epoch: 0, cue: { revision: first.revision, kind: "expression", id: "happy", value: 0.5 } });
    sockets[0].event({ type: "cue", epoch: 0, cue: { revision: second.revision, kind: "expression", id: "happy", value: 0.5 } });
    expect(cue).toHaveBeenCalledTimes(1);
    sockets[0].event({ type: "interrupted", epoch: 1 });
    sockets[0].event({ type: "cue", epoch: 0, cue: { revision: second.revision, kind: "expression", id: "curious", value: 0.5 } });
    expect(cue).toHaveBeenCalledTimes(1);
    sockets[0].event({ type: "cue", epoch: 1, cue: { revision: second.revision, kind: "expression", id: "curious", value: 0.5 } });
    expect(cue).toHaveBeenCalledTimes(2);
    value.setAvatarCapabilities(null);
    sockets[0].event({ type: "cue", epoch: 1, cue: { revision: second.revision, kind: "expression", id: "curious", value: 0.5 } });
    expect(cue).toHaveBeenCalledTimes(2);
  });
});
