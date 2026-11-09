import type {
  CompanionPreferences,
  Message,
  PendingAction,
} from "./contracts";
import { avatarControlSchema, normalizeAvatarCapabilities, type AvatarCapabilitiesSnapshot, type AvatarControl } from "./avatar-capabilities";
export type CompanionState = {
  memory?: { available: boolean; record: {
    revision: number;
    updatedAt: string;
    content: { summary: string; facts: string[]; openQuestions: string[] };
  } | null };
  phase:
    | "idle"
    | "connecting"
    | "listening"
    | "thinking"
    | "speaking"
    | "reconnecting";
  voice: boolean;
  busy: boolean;
  subtitle: string;
  error: string;
  messages: Message[];
  actions: PendingAction[];
  conversationId: string;
  textConfigured: boolean;
  voiceConfigured: boolean;
};
export type VoiceMetric = {
  name:
    | "estimated_utterance_to_audio_ms"
    | "asr_to_audio_ms"
    | "local_interrupt_ms"
    | "tool_ms";
  ms: number;
};
const initial: CompanionState = {
  phase: "idle",
  voice: false,
  busy: false,
  subtitle: "",
  error: "",
  messages: [],
  actions: [],
  conversationId: "",
  textConfigured: false,
  voiceConfigured: false,
};
export const errorText = (code: string) =>
  ({
    text_not_configured: "文字服务尚未配置，请在本地配置 DeepSeek 凭据。",
    voice_not_configured:
      "语音服务尚未配置，请在本地配置火山凭据并启动语音网关。",
    version_conflict: "内容已经变化或请求已处理，请刷新后检查当前记录。",
    confirmation_required: "请先查看当前确认卡，再说“确认保存”或点击确认。",
    unauthenticated: "登录已失效，请重新登录。",
    unavailable: "暂时无法连接蓝图，请稍后重试。",
    provider_unavailable: "回复暂时中断，请重试。",
    planning_disabled: "规划服务尚未配置，目标已保留。",
  })[code] ?? "连接暂时中断，请稍后重试。";
export async function companionRequest(
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/companion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ code: "unavailable" }));
    throw new Error(error.code ?? "unavailable");
  }
  return response;
}

/** One shared lifecycle for microphone, playback, text and confirmation. Audio is never persisted. */
export class CompanionRuntime {
  private state: CompanionState = { ...initial };
  private socket?: WebSocket;
  private media?: MediaStream;
  private context?: AudioContext;
  private capture?: AudioWorkletNode;
  private input?: MediaStreamAudioSourceNode;
  private silent?: GainNode;
  private gain?: GainNode;
  private analyser?: AnalyserNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextAudio = 0;
  private audioEpoch = 0;
  private request?: AbortController;
  private turn = 0;
  private animation = 0;
  private reconnect?: ReturnType<typeof setTimeout>;
  private caption?: ReturnType<typeof setTimeout>;
  private connecting = false;
  private attempts = 0;
  private disposed = false;
  private voiceGeneration = 0;
  private textActive = false;
  private voiceCaption = "";
  private voiceTranscript = "";
  private providerAudioDone = false;
  private refreshGeneration = 0;
  private pendingInterrupt?: string;
  private lastSpeechAt = 0;
  private asrCompletedAt = 0;
  private firstAudioPending = false;
  private measurements: VoiceMetric[] = [];
  private avatarCapabilities: AvatarCapabilitiesSnapshot | null = null;
  constructor(
    private update: (state: CompanionState) => void,
    private cue: (cue: AvatarControl, turn: number) => void,
    private lip: (value: number) => void,
    private onTurn: (turn: number) => void,
    private preference: () => CompanionPreferences,
    private onMetric?: (metric: VoiceMetric) => void,
  ) {}
  setAvatarCapabilities(input: AvatarCapabilitiesSnapshot | null) {
    this.avatarCapabilities = normalizeAvatarCapabilities(input);
    this.send({ type: "avatar_capabilities", capabilities: this.avatarCapabilities });
  }
  private applyCue(input: unknown, turn: number) {
    if (turn !== this.turn || !this.avatarCapabilities) return;
    const result = avatarControlSchema(this.avatarCapabilities).safeParse(input);
    if (result.success) this.cue(result.data, turn);
  }
  private metric(name: VoiceMetric["name"], ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    const metric = { name, ms };
    this.measurements.push(metric);
    if (this.measurements.length > 100) this.measurements.shift();
    this.onMetric?.(metric);
  }
  getMetrics() {
    return this.measurements.map((metric) => ({ ...metric }));
  }
  private set(next: Partial<CompanionState>) {
    this.state = { ...this.state, ...next };
    if (!this.disposed) this.update(this.state);
  }
  private send(event: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(event));
  }
  async refresh(clearError = false) {
    const generation = ++this.refreshGeneration;
    try {
      const data = await (
        await companionRequest({ operation: "bootstrap" })
      ).json();
      if (this.disposed || generation !== this.refreshGeneration) return null;
      this.set({
        ...(clearError ? { error: "" } : {}),
        messages: data.messages,
        actions: data.actions,
        conversationId: data.conversationId,
        textConfigured: data.textConfigured,
        voiceConfigured: data.voiceConfigured,
        memory: data.memory,
      });
      this.send({
        type: "pending_action",
        id:
          data.actions.find((a: PendingAction) => a.kind !== "planning")?.id ??
          null,
      });
      return data;
    } catch (e) {
      this.set({ error: errorText((e as Error).message) });
      return null;
    }
  }
  async history(before: string) {
    return (
      await (await companionRequest({ operation: "history", before })).json()
    ).messages as Message[];
  }
  private async audio() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.gain.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    await this.context.resume();
    this.gain!.gain.value = this.preference().volume;
    if (!this.animation) {
      const data = new Float32Array(this.analyser!.fftSize);
      const sample = () => {
        if (!this.context) return;
        this.analyser!.getFloatTimeDomainData(data);
        let power = 0;
        for (const v of data) power += v * v;
        this.lip(Math.min(1, Math.sqrt(power / data.length) * 7));
        this.animation = requestAnimationFrame(sample);
      };
      this.animation = requestAnimationFrame(sample);
    }
  }
  private flush() {
    this.providerAudioDone = false;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources.clear();
    this.nextAudio = 0;
    this.lip(0);
  }
  private playback(audio: string, epoch: number) {
    if (!this.context || this.pendingInterrupt || epoch < this.audioEpoch)
      return;
    this.audioEpoch = epoch;
    this.providerAudioDone = false;
    clearTimeout(this.caption);
    let raw: string;
    try {
      if (typeof audio !== "string") return;
      raw = atob(audio);
    } catch {
      this.set({ error: "语音数据未能播放，请重新开启语音。" });
      return;
    }
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (bytes.length % 2) return;
    const buffer = this.context.createBuffer(1, bytes.length / 2, 24000),
      samples = buffer.getChannelData(0),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++)
      samples[i] = view.getInt16(i * 2, true) / 32768;
    // Synthesis can arrive faster than playback. A normal multi-sentence reply
    // must not be mistaken for an interruption merely because its audio bursts.
    if (this.nextAudio - this.context.currentTime > 45) {
      this.interrupt();
      this.set({ error: "这次回复过长，已暂停播放。可以继续提问。" });
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (!this.sources.size) {
        if (this.providerAudioDone)
          this.send({ type: "playback_done", epoch: this.audioEpoch });
        if (!this.state.busy && this.providerAudioDone)
          this.set({ phase: this.state.voice ? "listening" : "idle" });
      }
    };
    const at = Math.max(this.context.currentTime + 0.015, this.nextAudio);
    source.start(at);
    if (this.firstAudioPending) {
      this.firstAudioPending = false;
      const first =
        performance.now() + Math.max(0, at - this.context.currentTime) * 1000;
      this.metric("asr_to_audio_ms", first - this.asrCompletedAt);
      if (this.lastSpeechAt > 0)
        this.metric(
          "estimated_utterance_to_audio_ms",
          first - this.lastSpeechAt,
        );
    }
    this.nextAudio = at + buffer.duration;
    this.set({ phase: "speaking" });
  }
  interrupt() {
    const started = performance.now(),
      hadPlayback = this.sources.size > 0;
    this.firstAudioPending = false;
    clearTimeout(this.caption);
    if (this.textActive) {
      this.textActive = false;
      this.send({ type: "text_cancel" });
    }
    this.request?.abort();
    this.request = undefined;
    this.turn++;
    this.onTurn(this.turn);
    this.flush();
    if (hadPlayback)
      this.metric("local_interrupt_ms", performance.now() - started);
    const requestId = crypto.randomUUID();
    if (this.socket?.readyState === WebSocket.OPEN)
      this.pendingInterrupt = requestId;
    this.send({ type: "interrupt", requestId });
    this.set({
      busy: false,
      subtitle: "",
      phase: this.state.voice ? "listening" : "idle",
    });
  }
  async startVoice() {
    if (this.state.voice || this.connecting) return;
    const generation = ++this.voiceGeneration;
    this.connecting = true;
    this.attempts = 0;
    this.set({ error: "", phase: "connecting" });
    try {
      // Credential/service checks precede requesting microphone permission.
      const bootstrap = await (
        await companionRequest({ operation: "voice" })
      ).json();
      if (this.disposed || generation !== this.voiceGeneration) return;
      await this.audio();
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (this.disposed || generation !== this.voiceGeneration) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      this.media = media;
      await this.context!.audioWorklet.addModule(
        "/companion-capture.worklet.js",
      );
      if (this.disposed || generation !== this.voiceGeneration) return;
      this.capture = new AudioWorkletNode(this.context!, "companion-capture");
      this.input = this.context!.createMediaStreamSource(this.media);
      this.silent = this.context!.createGain();
      this.silent.gain.value = 0;
      this.input.connect(this.capture);
      this.capture.connect(this.silent);
      this.silent.connect(this.context!.destination);
      this.capture.port.onmessage = (event) => {
        if (!this.state.voice) return;
        const { pcm, rms } = event.data;
        // RMS is useful for latency estimates, but noise/echo is not a user turn.
        // Seeduplex confirms speech before we stop playback; do not cancel a
        // response from an energy threshold while its tail audio is arriving.
        if (rms > 0.035) this.lastSpeechAt = performance.now();
        const bytes = new Uint8Array(pcm);
        let value = "";
        for (const b of bytes) value += String.fromCharCode(b);
        this.send({ type: "audio", audio: btoa(value) });
      };
      this.set({ voice: true });
      this.connect(bootstrap, generation);
    } catch (e) {
      if (generation !== this.voiceGeneration) return;
      this.stopVoice();
      const name = (e as Error).name;
      this.set({
        error:
          name === "NotAllowedError"
            ? "麦克风未获授权。允许麦克风后可重新开启，文字仍可使用。"
            : name === "NotFoundError"
              ? "没有找到麦克风，文字仍可使用。"
              : errorText((e as Error).message),
      });
    } finally {
      if (generation === this.voiceGeneration) this.connecting = false;
    }
  }
  private connect(
    bootstrap: { ticket: string; url: string },
    generation: number,
  ) {
    const socket = new WebSocket(bootstrap.url);
    this.socket = socket;
    this.audioEpoch = 0;
    socket.onopen = () => {
      if (this.socket === socket && generation === this.voiceGeneration)
        this.send({ type: "authenticate", ticket: bootstrap.ticket, capabilities: this.avatarCapabilities });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || generation !== this.voiceGeneration) return;
      let e: any;
      try {
        e = JSON.parse(event.data);
      } catch {
        return;
      }
      // Every gateway turn carries an epoch. Late control/text events must be
      // rejected just like late audio, before they can clear the current turn.
      if (Number.isInteger(e.epoch) && e.epoch < this.audioEpoch) return;
      if (e.type === "ready") {
        this.send({
          type: "pending_action",
          id: this.state.actions.find((a) => a.kind !== "planning")?.id ?? null,
        });
        this.pendingInterrupt = undefined;
        this.attempts = 0;
        this.set({ phase: "listening", error: "" });
      }
      if (e.type === "interrupted") {
        if (!Number.isInteger(e.epoch)) return;
        const acknowledged = !!this.pendingInterrupt &&
          e.requestId === this.pendingInterrupt;
        if (e.epoch > this.audioEpoch || acknowledged) {
          this.audioEpoch = e.epoch;
          this.flush();
          clearTimeout(this.caption);
        }
        if (acknowledged) this.pendingInterrupt = undefined;
      }
      if (e.type === "listening") {
        this.audioEpoch = e.epoch ?? this.audioEpoch;
        this.turn++;
        this.onTurn(this.turn);
        clearTimeout(this.caption);
        this.voiceTranscript = "";
        this.voiceCaption = "";
        this.flush();
        this.set({ phase: "listening", subtitle: "" });
      }
      if (e.type === "transcript") {
        this.voiceTranscript = e.text;
        this.set({ subtitle: this.voiceTranscript });
      }
      if (e.type === "user") {
        clearTimeout(this.caption);
        this.asrCompletedAt = performance.now();
        this.firstAudioPending = true;
        this.providerAudioDone = false;
        this.voiceCaption = "";
        this.set({ phase: "thinking", subtitle: e.text });
      }
      if (e.type === "delta") {
        clearTimeout(this.caption);
        this.voiceCaption += e.text;
        this.set({ subtitle: this.voiceCaption });
      }
      if (e.type === "responding") {
        clearTimeout(this.caption);
        this.providerAudioDone = false;
        this.set({ phase: "thinking" });
      }
      if (e.type === "audio") this.playback(e.audio, e.epoch);
      if (e.type === "audio_done") {
        if (this.pendingInterrupt || e.epoch !== this.audioEpoch) return;
        this.providerAudioDone = true;
        if (!this.sources.size) {
          this.send({ type: "playback_done", epoch: this.audioEpoch });
          if (!this.state.busy)
            this.set({ phase: this.state.voice ? "listening" : "idle" });
        }
        clearTimeout(this.caption);
        this.caption = setTimeout(
          () => {
            if (!this.state.busy && !this.sources.size)
              this.set({ subtitle: "" });
          },
          Math.max(
            3500,
            (this.nextAudio - (this.context?.currentTime ?? 0)) * 1000 + 1500,
          ),
        );
      }
      if (
        e.type === "cue" &&
        !this.pendingInterrupt &&
        e.epoch === this.audioEpoch
      )
        this.applyCue(e.cue, this.turn);
      if (e.type === "refresh") void this.refresh();
      if (e.type === "tool_metric") this.metric("tool_ms", e.ms);
      if (e.type === "error") this.set({ error: errorText(e.code) });
    };
    socket.onerror = () => {
      if (this.socket === socket)
        this.set({ error: "暂时无法连接语音网关，请确认网关已启动。" });
    };
    socket.onclose = (event) => {
      if (this.socket !== socket || generation !== this.voiceGeneration) return;
      this.flush();
      if (!this.state.voice || this.disposed) return;
      if (event.code === 1008) {
        this.stopVoice();
        this.set({ error: "语音会话验证失败，请重新登录后开启。" });
        return;
      }
      if (++this.attempts > 4) {
        this.stopVoice();
        this.set({ error: "语音连接未能恢复。请重新开启，文字对话仍可使用。" });
        return;
      }
      this.set({ phase: "reconnecting" });
      this.reconnect = setTimeout(
        () => {
          void companionRequest({ operation: "voice" })
            .then((r) => r.json())
            .then((b) => {
              if (this.state.voice && generation === this.voiceGeneration)
                this.connect(b, generation);
            })
            .catch(() => {
              if (generation === this.voiceGeneration) {
                this.stopVoice();
                this.set({ error: "语音连接恢复失败，请重新开启。" });
              }
            });
        },
        Math.min(1000 * 2 ** (this.attempts - 1), 8000),
      );
    };
  }
  stopVoice() {
    if (this.sources.size) this.send({ type: "interrupt" });
    this.voiceGeneration++;
    this.connecting = false;
    this.pendingInterrupt = undefined;
    clearTimeout(this.caption);
    this.voiceTranscript = "";
    this.voiceCaption = "";
    this.set({ voice: false, phase: "idle" });
    clearTimeout(this.reconnect);
    this.send({ type: "stop" });
    this.socket?.close();
    this.socket = undefined;
    this.media?.getTracks().forEach((t) => t.stop());
    this.media = undefined;
    this.capture?.disconnect();
    this.capture?.port.close();
    this.capture = undefined;
    this.input?.disconnect();
    this.input = undefined;
    this.silent?.disconnect();
    this.silent = undefined;
    this.flush();
  }
  async sendText(text: string) {
    if (!text.trim()) return;
    this.interrupt();
    const turn = this.turn,
      abort = new AbortController();
    this.request = abort;
    const spoken = this.state.voice;
    let answer = "",
      completed = false;
    if (spoken) {
      await this.audio();
      this.textActive = true;
      this.send({ type: "text_begin" });
    }
    this.set({ busy: true, phase: "thinking", subtitle: "", error: "" });
    try {
      const response = await companionRequest(
        {
          operation: "text",
          id: crypto.randomUUID(),
          text,
          capabilities: this.avatarCapabilities,
          actionId:
            this.state.actions.find((a) => a.kind !== "planning")?.id ?? null,
        },
        abort.signal,
      );
      if (response.headers.get("content-type")?.includes("application/json")) {
        const result = await response.json();
        if (result.confirmed) {
          completed = true;
          answer = result.message ?? "已保存。我们可以继续下一步。";
          this.set({ subtitle: answer });
          if (spoken) this.send({ type: "speak_append", text: answer });
        }
        await this.refresh();
        return;
      }
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (turn !== this.turn) {
          await reader.cancel();
          break;
        }
        pending += decoder.decode(part.value, { stream: true });
        let index: number;
        while ((index = pending.indexOf("\n\n")) >= 0) {
          const record = pending.slice(0, index);
          pending = pending.slice(index + 2);
          if (!record.startsWith("data: ")) continue;
          const event = JSON.parse(record.slice(6));
          if (event.type === "delta") {
            answer += event.text;
            this.set({ subtitle: answer });
            if (spoken) this.send({ type: "speak_append", text: event.text });
          }
          if (event.type === "cue") this.applyCue(event.cue, turn);
          if (event.type === "tools_changed") void this.refresh();
          if (event.type === "done") {
            completed = true;
            this.set({ messages: event.messages, actions: event.actions });
          }
          if (event.type === "error" && event.code !== "cancelled")
            throw new Error(event.code);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        this.set({ error: errorText((e as Error).message) });
    } finally {
      if (spoken && turn === this.turn) {
        this.textActive = false;
        if (completed)
          this.send({ type: "text_end", user: text, assistant: answer });
        else {
          // An interrupted partial answer must not become a completed QA pair.
          this.flush();
          this.send({ type: "interrupt" });
          this.send({ type: "text_cancel" });
        }
      }
      if (turn === this.turn) {
        this.set({
          busy: false,
          phase: this.sources.size
            ? "speaking"
            : this.state.voice
              ? "listening"
              : "idle",
        });
        clearTimeout(this.caption);
        this.caption = setTimeout(
          () => this.set({ subtitle: "" }),
          Math.max(
            7000,
            (this.nextAudio - (this.context?.currentTime ?? 0)) * 1000 + 1500,
          ),
        );
      }
    }
  }
  async confirm(id: string) {
    this.interrupt();
    const turn = this.turn;
    this.set({ busy: true, error: "" });
    try {
      const result = await (
        await companionRequest({ operation: "confirm", id })
      ).json();
      const message = result.message ?? "已保存。我们可以继续下一步。";
      if (turn === this.turn) {
        this.set({ subtitle: message });
        if (this.state.voice) {
          this.send({ type: "text_begin" });
          this.send({ type: "speak_append", text: message });
          this.send({ type: "text_end", user: "确认保存", assistant: message });
        }
      }
      await this.refresh();
    } catch (e) {
      if (turn === this.turn)
        this.set({ error: errorText((e as Error).message) });
    } finally {
      if (turn === this.turn) this.set({ busy: false });
    }
  }
  async cancel(id: string) {
    try {
      await companionRequest({ operation: "cancel", id });
      await this.refresh();
    } catch (e) {
      this.set({ error: errorText((e as Error).message) });
    }
  }
  async clear() {
    this.interrupt();
    this.stopVoice();
    await companionRequest({ operation: "clear" });
    await this.refresh();
  }
  dispose() {
    this.disposed = true;
    this.request?.abort();
    clearTimeout(this.caption);
    this.stopVoice();
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    void this.context?.close();
    this.context = undefined;
  }
}
