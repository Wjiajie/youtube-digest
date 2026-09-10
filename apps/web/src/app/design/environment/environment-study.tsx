"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Panel, Status } from "@blueprint/ui";
import { ThemeSurface, type ThemeId } from "@blueprint/ui/theme";
import { ThemePicker } from "@blueprint/ui/theme-picker";
import { disposeEnvironmentKit, loadEnvironmentKit, type EnvironmentKit } from "@/lib/scene/environment-kit";
import { EnvironmentCanvas } from "./environment-canvas";
import "./environment-study.css";

export default function EnvironmentStudy() {
  const [theme, setTheme] = useState<ThemeId>("eastern");
  const [quality, setQuality] = useState<"standard" | "low">("standard");
  const [current, setCurrent] = useState<{ kit: EnvironmentKit; bytes: number } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [flat, setFlat] = useState(false), [unavailable, setUnavailable] = useState(false);
  const [rendered, setRendered] = useState(false), [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => () => { if (current) disposeEnvironmentKit(current.kit); }, [current]);
  const onUnavailable = useCallback(() => { setUnavailable(true); setRendered(false); }, []);
  const onRendered = useCallback(() => setRendered(true), []);

  async function load(files: File[]) {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const kit = await loadEnvironmentKit(files);
      if (id !== request.current) { disposeEnvironmentKit(kit); return; }
      setCurrent({ kit, bytes: files.reduce((sum, file) => sum + file.size, 0) });
      setUnavailable(false); setRendered(false);
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "文件无法读取。");
    } finally { if (id === request.current) setLoading(false); }
  }
  function clear() {
    request.current++; setLoading(false); setCurrent(null); setError(""); setUnavailable(false); setRendered(false);
  }

  return <ThemeSurface theme={theme}><main className="environment-study shell">
    <a href="/design">← 返回设计预览</a>
    <header><span className="brand">BLUEPRINT / ENVIRONMENT STUDY</span><h1>让目标世界有自己的风景</h1>
      <p>内部环境构图试验：真实自然资产、两种空间表达。人物席位留空，尚未完成正式主角、商业美术与性能验收。</p></header>
    <Panel className="environment-toolbar">
      <label className="field"><span>选择四件环境 GLB（合计最多 10 MB）</span><input type="file" accept=".glb" multiple disabled={loading} onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
        if (files.length) void load(files);
      }} /></label>
      <div className="actions"><ThemePicker value={theme} onChange={value => { if (value !== theme) { setRendered(false); setTheme(value); } }} />
        <label className="field"><span>场景画质</span><select value={quality} onChange={event => { const value = event.currentTarget.value === "low" ? "low" : "standard"; if (value !== quality) { setRendered(false); setQuality(value); } }}><option value="standard">标准 · 阴影</option><option value="low">低画质 · 无阴影</option></select></label>
        <label><input type="checkbox" checked={flat} onChange={event => { setRendered(false); setFlat(event.currentTarget.checked); }} /> 使用二维文字视图</label>
        <Button disabled={!current && !loading} onClick={clear}>清除环境</Button>
      </div>
      <Status>{loading ? "正在本地校验四件环境……" : current ? `已解析四件环境 · ${(current.bytes / 1024).toFixed(1)} KB；${rendered ? "已绘制首帧，仍待美术评审。" : "解析不等于画面已显示。"}` : "尚未载入环境；请选择下列四件本地文件。"}</Status>
      {error ? <Status tone="danger">{error} 当前已加载环境保留。</Status> : null}
    </Panel>
    <section className="environment-stage" aria-label="环境构图预览">
      {current && !flat && !unavailable ? <EnvironmentCanvas key={`${current.kit.rockWide.scene.uuid}-${theme}-${quality}-${attempt}`}
        kit={current.kit} theme={theme} quality={quality} onUnavailable={onUnavailable} onRendered={onRendered} />
        : <div className="environment-fallback"><h2>{unavailable ? "3D 暂不可用" : flat ? "二维文字视图" : "等待真实环境资产"}</h2>
          <p>东方研究：层叠岩石、松树、远近雾色与留白。赛博研究：生态展台、结构线与冷暖轮廓光。它们是环境对照，不是两套已验收的成品主题。</p>
          <p>所有文件入口和主题控件仍可使用；不会上传资源或修改个人数据。</p>
          {unavailable && !flat ? <Button onClick={() => { setUnavailable(false); setRendered(false); setAttempt(value => value + 1); }}>重试 3D</Button> : null}
        </div>}
    </section>
    <section className="environment-notes" aria-label="素材与制作说明"><div><h2>四件真实素材，一组构图研究</h2>
      <ul className="environment-source-list"><li>宽岩石：rock_largeA.glb</li><li>高岩石：rock_tallA.glb</li><li>高松：tree_pineTallA.glb</li><li>平展树：tree_plateau.glb</li></ul>
      <p>Kenney · Nature Kit，包内 CC0。原文件在本页读取，不上传、不缓存、不随源码或生产扩展分发；请使用已核验的四件下载文件。</p></div>
      <div><h2>观察，而不制造进展</h2><p>默认静止、按需绘制，可拖动观察与重置镜头；不自动旋转、播放动画或制造用户成果。低画质关闭阴影并限制像素密度。非 WebGL 时保留文字说明。</p>
        <p>自然模型适配、完整人物和两主题最终材质仍待制作。当前画面不证明桌面 60 FPS、首屏 8 MB 或商业美术验收已通过。</p></div>
    </section>
  </main></ThemeSurface>;
}
