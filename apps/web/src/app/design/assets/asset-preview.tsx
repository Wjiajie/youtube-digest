"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { AnimationMixer, Box3, LoadingManager, Mesh, PCFShadowMap, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Button, Panel, Status } from "@blueprint/ui";
import { ThemeSurface } from "@blueprint/ui/theme";
import { validatePreviewAsset } from "@/lib/scene/preview-asset";
import { disposeAsset } from "@/lib/scene/asset-resources";

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Status tone="danger">3D 不可用，文件与文字检查仍可进行；可清除后重新选择文件。</Status> : this.props.children; }
}

function Model({ asset, animate, hideWeapon }: { asset: GLTF; animate: boolean; hideWeapon: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  const mixer = useMemo(() => new AnimationMixer(asset.scene), [asset]);
  const framing = useMemo(() => {
    const box = new Box3().setFromObject(asset.scene);
    const center = box.getCenter(new Vector3());
    const scale = 2 / box.getSize(new Vector3()).y;
    return { scale, position: [-center.x * scale, -box.min.y * scale, -center.z * scale] as [number, number, number] };
  }, [asset]);
  useEffect(() => {
    const idle = asset.animations.find((clip) => clip.name === "Idle_Neutral");
    if (idle) { mixer.clipAction(idle).play(); mixer.update(0); invalidate(); }
    return () => { mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); };
  }, [asset, mixer, invalidate]);
  useEffect(() => {
    asset.scene.traverse((object) => {
      if (object.name === "Sword") object.visible = !hideWeapon;
    });
    invalidate();
  }, [asset, hideWeapon, invalidate]);
  useFrame((_, delta) => { if (animate) mixer.update(Math.min(delta, .05)); });
  return <group {...framing}><primitive object={asset.scene} /></group>;
}

export default function AssetPreview() {
  const [asset, setAsset] = useState<GLTF | null>(null);
  const [message, setMessage] = useState("选择已核验来源的内嵌 glTF 文件，开始真实渲染检查。");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [hideWeapon, setHideWeapon] = useState(true);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [visible, setVisible] = useState(true);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setMotionAllowed(!media.matches); setVisible(!document.hidden); };
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => { media.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => () => { if (asset) disposeAsset(asset); }, [asset]);

  async function load(file: File) {
    const current = ++request.current;
    setLoading(true); setError("");
    let loaded: GLTF | undefined;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("试装文件不能超过 10 MB。");
      const text = await file.text();
      validatePreviewAsset(text);
      const manager = new LoadingManager();
      manager.setURLModifier((url) => {
        if (!/^(data:|blob:)/.test(url)) throw new Error("试装禁止请求外部资源。");
        return url;
      });
      loaded = await new GLTFLoader(manager).parseAsync(text, "");
      const height = new Box3().setFromObject(loaded.scene).getSize(new Vector3()).y;
      if (!Number.isFinite(height) || height <= 0) throw new Error("文件没有可显示的有效几何体。");
      if (current !== request.current) { disposeAsset(loaded); return; }
      let meshes = 0;
      loaded.scene.traverse((object) => { if (object instanceof Mesh) { meshes += 1; object.castShadow = true; object.receiveShadow = true; } });
      setAsset(loaded);
      setMessage(`已解析 ${file.name} · ${meshes} 个网格 · ${loaded.animations.length} 个动作 · ${(file.size / 1024 / 1024).toFixed(2)} MB；尚未通过美术验收。`);
    } catch (cause) {
      if (loaded) disposeAsset(loaded);
      if (current === request.current) setError(cause instanceof Error ? cause.message : "文件无法读取，当前场景保留。");
    } finally { if (current === request.current) setLoading(false); }
  }

  const playing = animate && motionAllowed && visible;
  return <ThemeSurface theme="cyberpunk"><main className="shell">
    <a href="/design" style={{ color: "var(--bp-accent)" }}>← 返回双主题控件</a>
    <h1 style={{ fontSize: 32, margin: "24px 0 12px" }}>人物资产 · 实时试装</h1>
    <p className="subtle">内部制作工具，不是正式蓝图。文件只在本页解析，不上传，不写入账号；不支持外链资源或压缩解码插件。</p>
    <Panel style={{ padding: 24, margin: "24px 0" }}>
      <label className="field"><span>选择内嵌 glTF 2.0（最多 10 MB）</span><input type="file" accept=".gltf" disabled={loading} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void load(file);
        event.currentTarget.value = "";
      }} /></label>
      <div className="actions">
        <label><input type="checkbox" checked={animate} onChange={(event) => setAnimate(event.currentTarget.checked)} /> 播放中性待机（减少动态效果时暂停）</label>
        <label><input type="checkbox" checked={hideWeapon} onChange={(event) => setHideWeapon(event.currentTarget.checked)} /> 隐藏已识别的 Sword 部件</label>
        <Button disabled={!asset || loading} onClick={() => { setAsset(null); setMessage("场景已清除；可重新选择文件。"); setError(""); }}>清除场景</Button>
      </div>
      <Status>{loading ? "正在本地解析文件……" : message}</Status>
      {error ? <Status tone="danger">{error} 当前已加载场景不变。</Status> : null}
    </Panel>
    <section aria-label="人物实时渲染，拖动旋转，滚轮缩放" style={{ height: "min(68vh, 720px)", minHeight: 360, border: "1px solid var(--bp-line)", borderRadius: 16, overflow: "hidden", background: "#08131e" }}>
      {asset ? <SceneBoundary key={asset.scene.uuid}><Canvas shadows={{ type: PCFShadowMap }} dpr={[1, 1.5]} frameloop={playing ? "always" : "demand"} camera={{ position: [3, 1.8, 4.5], fov: 36 }} fallback={<Status tone="warning">当前设备不支持 WebGL，可继续使用文字检查。</Status>}>
        <color attach="background" args={["#08131e"]} />
        <ambientLight intensity={.8} />
        <directionalLight position={[3, 5, 4]} intensity={3} castShadow shadow-mapSize={[1024, 1024]} shadow-normalBias={.04} />
        <directionalLight position={[-3, 2, -2]} intensity={2} color="#52dcff" />
        <Model asset={asset} animate={playing} hideWeapon={hideWeapon} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.02, 0]} receiveShadow><circleGeometry args={[2.2, 64]} /><meshStandardMaterial color="#203747" roughness={.7} /></mesh>
        <OrbitControls target={[0, 1, 0]} enablePan={false} minDistance={2} maxDistance={9} maxPolarAngle={Math.PI / 2} />
      </Canvas></SceneBoundary> : <p className="subtle" style={{ padding: 32 }}>尚未载入真实人物，不以几何占位模型代替验收。</p>}
    </section>
  </main></ThemeSurface>;
}
