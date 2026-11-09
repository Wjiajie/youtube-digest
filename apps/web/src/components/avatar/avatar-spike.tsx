"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useRef, useState } from "react";
import { VrmModel } from "./vrm-model";
import "./avatar-spike.css";

export function AvatarSpike() {
  const [ready, setReady] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakRequest, setSpeakRequest] = useState(0);
  const [blinkRequest, setBlinkRequest] = useState(0);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const ensureAudio = useCallback(() => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    void audioContextRef.current.resume();
    return audioContextRef.current;
  }, []);

  const handleSpeak = useCallback(() => {
    if (!ready || speaking) return;
    ensureAudio();
    setSpeakRequest((value) => value + 1);
  }, [ensureAudio, ready, speaking]);

  const handleReady = useCallback(() => setReady(true), []);
  const handleSpeakingChange = useCallback((value: boolean) => setSpeaking(value), []);
  const handleError = useCallback((message: string) => setError(message), []);
  const handleFps = useCallback((value: number) => setFps(value), []);

  return (
    <div className="avatar-spike">
      <div className="avatar-spike__veil" aria-hidden="true" />
      <Canvas
        className="avatar-spike__canvas"
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 20, position: [0, 1.2, 3.2], near: 0.1, far: 20 }}
      >
        <ambientLight intensity={1.15} />
        <directionalLight position={[1.2, 2, 1.4]} intensity={1.7} />
        <directionalLight position={[-1.2, 1.2, -1]} intensity={0.35} />
        <Suspense fallback={null}>
          <VrmModel
            speakRequest={speakRequest}
            blinkRequest={blinkRequest}
            audioContextRef={audioContextRef}
            onReady={handleReady}
            onSpeakingChange={handleSpeakingChange}
            onError={handleError}
            onFps={handleFps}
          />
        </Suspense>
      </Canvas>

      <header className="avatar-spike__header">
        <div className="avatar-spike__brand">
          <span className="avatar-spike__seal">行</span>
          <span>BLUEPRINT / AVATAR P0</span>
        </div>
        <a className="avatar-spike__back" href="/preview">
          返回 Blueprint
        </a>
      </header>

      <section className="avatar-spike__intro">
        <p className="avatar-spike__eyebrow">身份锚点 · 第一次试装</p>
        <h1>你的蓝图化身</h1>
        <p className="avatar-spike__lede">
          VRM 1.0 · 待机 / 眨眼 / 呼吸 / 看镜头 / 口型
        </p>
        <p className="avatar-spike__note">
          sample: VRM1_Constraint_Twist_Sample（仅用于 P0 验证，不是正式角色）
        </p>
      </section>

      <div className="avatar-spike__controls" role="group" aria-label="化身测试控制">
        <button
          type="button"
          className="avatar-spike__button avatar-spike__button--primary"
          onClick={handleSpeak}
          disabled={!ready || speaking}
        >
          {speaking ? "正在说话…" : "说话测试"}
        </button>
        <button
          type="button"
          className="avatar-spike__button"
          onClick={() => setBlinkRequest((value) => value + 1)}
          disabled={!ready}
        >
          眨一下眼
        </button>
        <span className="avatar-spike__status" aria-live="polite">
          {error ? "加载失败：" + error : ready ? "已就绪 · " + fps + " fps" : "正在加载 sample VRM…"}
        </span>
      </div>
    </div>
  );
}
