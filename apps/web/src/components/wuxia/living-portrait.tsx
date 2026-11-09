"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PortraitPointer } from "@/lib/scene/living-portrait-motion";
import "./living-portrait.css";

const PortraitCanvas = dynamic(() => import("./living-portrait-canvas"), { ssr: false });
class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function LivingPortrait({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [paused, setPaused] = useState(false), [original, setOriginal] = useState(false), [parallax, setParallax] = useState(true);
  const [intensity, setIntensity] = useState(.8), [attempt, setAttempt] = useState(0), [revision, setRevision] = useState(0);
  const [entered, setEntered] = useState(false), [inView, setInView] = useState(false), [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false), [preferencesReady, setPreferencesReady] = useState(false);
  const root = useRef<HTMLDivElement>(null), pointer = useRef<PortraitPointer>({ x: 0, y: 0 });
  const ready = useCallback(() => setStatus("ready"), []), fail = useCallback(() => setStatus("error"), []);
  const active = !paused && !original && !reduced && visible && inView;

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => { setReduced(preference.matches); setStatus("loading"); setPreferencesReady(true); };
    const updateVisibility = () => setVisible(document.visibilityState !== "hidden");
    updatePreference(); updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    const element = root.current!;
    const near = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) { setEntered(true); near.disconnect(); } }, { rootMargin: "200px" });
    const viewport = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? false));
    near.observe(element); viewport.observe(element);
    return () => { near.disconnect(); viewport.disconnect(); preference.removeEventListener("change", updatePreference); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);
  useEffect(() => {
    if (status !== "loading" || !entered || reduced || !preferencesReady) return;
    const timer = setTimeout(fail, 25000);
    return () => clearTimeout(timer);
  }, [status, entered, reduced, preferencesReady, fail, attempt]);
  const reset = () => { pointer.current = { x: 0, y: 0 }; setRevision(value => value + 1); };
  const retry = () => { setStatus("loading"); setAttempt(value => value + 1); reset(); };
  const showPoster = original || reduced || status !== "ready";
  return <div ref={root} className={`living-portrait${embedded ? " living-portrait--embedded" : ""}`} data-state={reduced ? "static" : status} data-paused={!active} data-version="wuxia-living-v2">
    <div className="living-stage" data-testid="living-stage" tabIndex={0} role="region" aria-label="舟上武侠人物与山水动态场景，方向键可轻移视角"
      onPointerMove={event => {
        if (!active || event.pointerType === "touch" || !parallax) return;
        if ((event.target as Element).closest("button,input,a")) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        pointer.current = { x: (event.clientX - bounds.left) / bounds.width * 2 - 1, y: (event.clientY - bounds.top) / bounds.height * 2 - 1 };
      }}
      onPointerLeave={() => { if (active) pointer.current = { x: 0, y: 0 }; }}
      onKeyDown={event => {
        if (!active || !parallax || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") { reset(); return; }
        const limit = (n: number) => Math.max(-1, Math.min(1, n));
        pointer.current = { x: limit(pointer.current.x + (event.key === "ArrowRight" ? .25 : event.key === "ArrowLeft" ? -.25 : 0)), y: limit(pointer.current.y + (event.key === "ArrowDown" ? .25 : event.key === "ArrowUp" ? -.25 : 0)) };
      }}>
      {/* A baked composition preserves the independent-layer appearance before WebGL is ready. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={`living-poster${showPoster ? " is-visible" : ""}`} src={original ? "/scenes/wuxia/v2/reference.png" : "/scenes/wuxia/v2/poster.png"} width={1670} height={941}
        alt="晨光穿过湖山云雾，一位白衣侠女持剑坐在木舟上" loading={embedded ? "lazy" : "eager"} decoding="async" draggable={false} />
      {entered && preferencesReady && !reduced && status !== "error" && <div className="living-canvas" aria-hidden="true">
        <SceneBoundary key={attempt} onError={fail}><PortraitCanvas active={active} intensity={intensity} parallax={parallax} resetRevision={revision} pointer={pointer} onReady={ready} onError={fail} /></SceneBoundary>
      </div>}
      <div className="living-scene-heading" aria-hidden="true"><span className="living-seal">行</span><span>云水之间<small>一叶轻舟 · 一程江湖</small></span></div>
      {status === "loading" && entered && preferencesReady && !reduced && <span className="living-loading" role="status">画面就绪，正在唤起微风…</span>}
      {reduced && <span className="living-loading" role="status">已遵循系统的减少动态效果设置</span>}
    </div>
    <div className="living-controls" aria-label="场景控制">
      <div className="living-atmosphere"><i aria-hidden="true" className={active && status === "ready" ? "is-active" : ""} />{original ? "原始画面" : reduced ? "静观山水" : paused ? "风息片刻" : "晨雾 · 微风"}</div>
      <div className="living-buttons">
        <button type="button" aria-pressed={paused} disabled={reduced || !preferencesReady} onClick={() => setPaused(value => !value)}>{paused ? "继续播放" : "暂停动效"}</button>
        {!embedded && <><button type="button" aria-pressed={original} disabled={!preferencesReady} onClick={() => { setOriginal(value => !value); reset(); }}>{original ? "返回动态" : "对照原图"}</button>
          <button type="button" aria-pressed={parallax} disabled={reduced || !preferencesReady} onClick={() => { setParallax(value => !value); reset(); }}>视差</button>
          <label className="living-wind">风力<input aria-label="风力" type="range" min="0" max="1" step=".05" value={intensity} disabled={reduced || !preferencesReady} onChange={event => setIntensity(Number(event.target.value))} /></label>
          <button type="button" disabled={!preferencesReady} onClick={reset}>归位</button></>}
        {embedded && <a href="/scenes/wuxia" aria-label="打开完整山水场景">展开 ↗</a>}
      </div>
    </div>
    {status === "error" && <div className="living-error" role="status">微风暂未加载，仍可欣赏原画。<button type="button" onClick={retry}>重新加载</button></div>}
    <noscript><p className="living-error">已显示原画。启用 JavaScript 后可使用视差与动效。</p></noscript>
  </div>;
}
