"use client";

import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createRoot, extend, useFrame, useThree, type ReconcilerRoot, type RootStore } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Button } from "@blueprint/ui";
import type { ThemeId } from "@blueprint/ui/theme";
import type { EnvironmentKit } from "@/lib/scene/environment-kit";

type Props = { kit: EnvironmentKit; theme: ThemeId; quality: "standard" | "low";
  onUnavailable: () => void; onRendered?: () => void };
type ViewAction = "reset" | "left" | "right" | "in" | "out";
type Position = [number, number, number];

class RenderBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function EnvironmentCanvas(props: Props) {
  // This internal study deliberately recreates the renderer when its composition
  // changes. The received kit remains owned by the controller throughout.
  return <EnvironmentRenderer key={`${props.kit.rockWide.scene.uuid}:${props.theme}:${props.quality}`} {...props} />;
}

function EnvironmentRenderer({ kit, theme, quality, onUnavailable, onRendered }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewAction = useRef<((action: ViewAction) => void) | null>(null);
  const callbacks = useRef({ onUnavailable, onRendered }); callbacks.current = { onUnavailable, onRendered };
  useEffect(() => {
    const element = canvas.current, container = host.current;
    if (!element || !container) return;
    let cancelled = false, failed = false;
    let root: ReconcilerRoot<HTMLCanvasElement> | undefined, store: RootStore | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    function unavailable() {
      if (cancelled || failed) return;
      failed = true;
      queueMicrotask(() => { if (!cancelled) callbacks.current.onUnavailable(); });
    }
    function contextLost(event: Event) { event.preventDefault(); unavailable(); }
    element.addEventListener("webglcontextlost", contextLost);
    element.addEventListener("webglcontextcreationerror", unavailable);
    const measure = () => {
      const rect = container.getBoundingClientRect();
      return { width: Math.max(1, rect.width), height: Math.max(1, rect.height), top: rect.top, left: rect.left };
    };
    const resize = new ResizeObserver(() => {
      if (cancelled || !store) return;
      try {
        const size = measure(); store.getState().setSize(size.width, size.height, size.top, size.left); store.getState().invalidate();
      } catch { unavailable(); }
    });
    resize.observe(container);
    // Defer acquisition past abandoned Strict Mode setups, and catch configure's
    // async rejection explicitly (a React error boundary cannot catch it).
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      try {
        extend({ Group: THREE.Group, Mesh: THREE.Mesh, Color: THREE.Color, Fog: THREE.Fog,
          HemisphereLight: THREE.HemisphereLight, DirectionalLight: THREE.DirectionalLight,
          CircleGeometry: THREE.CircleGeometry, CylinderGeometry: THREE.CylinderGeometry,
          TorusGeometry: THREE.TorusGeometry, BoxGeometry: THREE.BoxGeometry,
          MeshStandardMaterial: THREE.MeshStandardMaterial, MeshBasicMaterial: THREE.MeshBasicMaterial });
        // Acquire WebGL before registering a reconciler root: capability failure
        // must not leave a half-configured R3F root behind.
        renderer = new THREE.WebGLRenderer({ canvas: element, antialias: quality === "standard", alpha: false,
          powerPreference: quality === "low" ? "low-power" : "high-performance" });
        root = createRoot(element);
        await root.configure({
          gl: renderer,
          frameloop: "demand", dpr: quality === "low" ? 1 : [1, 1.5],
          shadows: quality === "standard" ? { type: THREE.PCFShadowMap } : false,
          camera: { position: [10, 8, 13], fov: 42, near: .1, far: 100 }, size: measure(),
          onCreated: state => { state.gl.debug.onShaderError = unavailable; },
        });
        if (cancelled || failed) { root.unmount(); return; }
        store = root.render(<RenderBoundary onUnavailable={unavailable}>
          <StudyScene kit={kit} theme={theme} quality={quality} onUnavailable={unavailable}
            onRendered={() => { if (!cancelled && !failed) callbacks.current.onRendered?.(); }}
            attachControls={handler => { viewAction.current = handler; }} />
        </RenderBoundary>);
        const size = measure(); store.getState().setSize(size.width, size.height, size.top, size.left);
      } catch { unavailable(); }
    });
    return () => {
      cancelled = true; viewAction.current = null; resize.disconnect();
      element.removeEventListener("webglcontextlost", contextLost);
      element.removeEventListener("webglcontextcreationerror", unavailable);
      root?.unmount();
      renderer?.dispose();
    };
  }, [kit, theme, quality]);
  return <div className="environment-renderer">
    <div className="environment-canvas-host" ref={host}>
      <canvas ref={canvas} tabIndex={0} aria-label="真实环境构图试验，拖动旋转、滚轮缩放；也可使用下方观察按钮">浏览器无法显示 WebGL，请切换二维文字视图。</canvas>
    </div>
    <div className="environment-view-controls" aria-label="环境观察控制">
      <Button onClick={() => viewAction.current?.("left")}>向左观察</Button><Button onClick={() => viewAction.current?.("right")}>向右观察</Button>
      <Button onClick={() => viewAction.current?.("in")}>拉近</Button><Button onClick={() => viewAction.current?.("out")}>拉远</Button>
      <Button onClick={() => viewAction.current?.("reset")}>重置镜头</Button>
    </div>
    <p className="environment-canvas-caption">{theme === "eastern" ? "山势、松林与水面留白" : "夜间生态展台与环形边缘光"} · 真实环境素材构图研究，人物席位留空；不是两套最终世界。</p>
  </div>;
}

function BorrowedModel({ asset, position, height, footprint = Infinity, rotation = 0, shadows }: {
  asset: GLTF; position: Position; height: number; footprint?: number; rotation?: number; shadows: boolean;
}) {
  const placement = useMemo(() => {
    const scene = asset.scene.clone(true);
    scene.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = shadows; object.receiveShadow = shadows; } });
    const box = new THREE.Box3().setFromObject(scene), center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // A wide, low rock must fit its exhibit instead of hiding the central seat.
    const scale = Math.min(height / size.y, footprint / Math.max(size.x, size.z));
    return { scene, scale, offset: [-center.x * scale, -box.min.y * scale, -center.z * scale] as Position };
  }, [asset, height, footprint, shadows]);
  return <group position={position} rotation={[0, rotation, 0]}><group position={placement.offset} scale={placement.scale}>
    <primitive object={placement.scene} dispose={null} />
  </group></group>;
}

function CameraRig({ theme, attachControls }: { theme: ThemeId; attachControls: (handler: ((action: ViewAction) => void) | null) => void }) {
  const { camera, gl, invalidate, size } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = false; controls.autoRotate = false; controls.enablePan = false;
    controls.minDistance = 7; controls.maxDistance = 42; controls.minPolarAngle = .22; controls.maxPolarAngle = Math.PI * .47;
    const target = new THREE.Vector3(theme === "eastern" ? -.7 : 0, 1, 0);
    const distanceFactor = Math.max(1, 1.15 / (size.width / size.height));
    const home = new THREE.Vector3(...(theme === "eastern" ? [10, 7.5, 13] as const : [11, 10, 12] as const)).multiplyScalar(distanceFactor).add(target);
    const change = () => invalidate(); controls.addEventListener("change", change);
    function reset() { controls.target.copy(target); camera.position.copy(home); controls.update(); invalidate(); }
    reset();
    attachControls(action => {
      if (action === "reset") { reset(); return; }
      const offset = camera.position.clone().sub(controls.target);
      if (action === "left" || action === "right") offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (action === "left" ? 1 : -1) * Math.PI / 12);
      else offset.setLength(THREE.MathUtils.clamp(offset.length() * (action === "in" ? .85 : 1.15), controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset); controls.update(); invalidate();
    });
    return () => { attachControls(null); controls.removeEventListener("change", change); controls.dispose(); };
  }, [camera, gl, invalidate, theme, size.width, size.height, attachControls]);
  return null;
}

function StudyScene({ kit, theme, quality, onUnavailable, onRendered, attachControls }: Props & {
  attachControls: (handler: ((action: ViewAction) => void) | null) => void;
}) {
  const reported = useRef(false);
  useFrame(({ gl, scene, camera }) => {
    try {
      if (gl.getContext().isContextLost()) { onUnavailable(); return; }
      // Positive priority owns this demand frame. Notify only after the actual
      // render call has completed, not when GLTF parsing or root setup finishes.
      gl.render(scene, camera);
      if (!reported.current && gl.info.render.calls > 0) { reported.current = true; queueMicrotask(() => onRendered?.()); }
    } catch { onUnavailable(); }
  }, 1);
  const shadows = quality === "standard";
  return <>
    <CameraRig theme={theme} attachControls={attachControls} />
    <color attach="background" args={[theme === "eastern" ? "#d8dfd4" : "#050e19"]} />
    <fog attach="fog" args={[theme === "eastern" ? "#d8dfd4" : "#050e19", theme === "eastern" ? 23 : 27, 58]} />
    <hemisphereLight args={[theme === "eastern" ? "#eef4dd" : "#92c8ef", theme === "eastern" ? "#718277" : "#102136", theme === "eastern" ? 2.1 : .9]} />
    <directionalLight position={theme === "eastern" ? [-7, 12, 6] : [4, 10, 6]} intensity={theme === "eastern" ? 2.2 : 2.5}
      color={theme === "eastern" ? "#fff4d6" : "#d7ebff"} castShadow={shadows} shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-11} shadow-camera-right={11} shadow-camera-top={11} shadow-camera-bottom={-11} shadow-camera-far={40} shadow-normalBias={.05} />
    <directionalLight position={theme === "eastern" ? [6, 4, -8] : [-5, 4, -6]} color={theme === "eastern" ? "#b5d6c9" : "#5bf6d1"} intensity={theme === "eastern" ? .7 : 2.6} />
    {theme === "eastern" ? <EasternLandscape kit={kit} shadows={shadows} /> : <CyberExhibit kit={kit} shadows={shadows} />}
  </>;
}

function EasternLandscape({ kit, shadows }: { kit: EnvironmentKit; shadows: boolean }) {
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.16, 0]} receiveShadow={shadows}><circleGeometry args={[10, 64]} /><meshStandardMaterial color="#839b91" roughness={.48} metalness={.1} /></mesh>
    <mesh position={[-2.3, -.02, -.5]} scale={[1.4, 1, .9]} receiveShadow={shadows}><cylinderGeometry args={[3.7, 4, .24, 48]} /><meshStandardMaterial color="#73796a" roughness={1} /></mesh>
    <BorrowedModel asset={kit.rockTall} position={[-3.5, .1, -2.8]} height={5.7} rotation={.4} shadows={shadows} />
    <BorrowedModel asset={kit.rockTall} position={[-.8, .1, -3.7]} height={4.2} rotation={2} shadows={shadows} />
    <BorrowedModel asset={kit.rockWide} position={[-3.7, .1, .3]} height={1.7} rotation={-.4} shadows={shadows} />
    <BorrowedModel asset={kit.rockWide} position={[3.6, -.05, -2.8]} height={1.15} rotation={1.6} shadows={shadows} />
    <BorrowedModel asset={kit.pine} position={[-4.5, .2, -1]} height={4.3} rotation={.5} shadows={shadows} />
    <BorrowedModel asset={kit.pine} position={[-1.5, .2, -1.8]} height={3.4} rotation={1.4} shadows={shadows} />
    <BorrowedModel asset={kit.canopy} position={[-4, .2, 1.8]} height={2.8} rotation={-.6} shadows={shadows} />
    <mesh position={[1.1, .06, 1.5]} receiveShadow={shadows}><cylinderGeometry args={[1.3, 1.42, .32, 48]} /><meshStandardMaterial color="#c2c4b1" roughness={.95} /></mesh>
    {[0, 1, 2].map(index => <mesh key={index} position={[-.2 - index * .75, -.01, 2.1 + index * .24]} receiveShadow={shadows}><cylinderGeometry args={[.28, .34, .16, 7]} /><meshStandardMaterial color="#a1aaa0" roughness={1} /></mesh>)}
  </>;
}

function CyberExhibit({ kit, shadows }: { kit: EnvironmentKit; shadows: boolean }) {
  const exhibits: { position: Position; asset: GLTF; height: number; rotation: number }[] = [
    { position: [-3.1, .5, -2.4], asset: kit.pine, height: 4.6, rotation: .3 },
    { position: [3.1, .5, -2.4], asset: kit.canopy, height: 3.8, rotation: -.6 },
    { position: [-3.1, .5, 2.4], asset: kit.rockTall, height: 2.8, rotation: .5 },
    { position: [3.1, .5, 2.4], asset: kit.rockWide, height: 1.9, rotation: 1.1 },
  ];
  return <>
    <mesh position={[0, -.3, 0]} receiveShadow={shadows}><cylinderGeometry args={[7.5, 8, .4, 8]} /><meshStandardMaterial color="#152735" roughness={.8} metalness={.35} /></mesh>
    <mesh position={[0, .02, 0]} receiveShadow={shadows}><cylinderGeometry args={[1.3, 1.55, .5, 8]} /><meshStandardMaterial color="#253e4a" metalness={.55} roughness={.45} /></mesh>
    {[1.6, 6.9].map(radius => <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, -.07, 0]}><torusGeometry args={[radius, .025, 6, 96]} /><meshBasicMaterial color="#63efd0" /></mesh>)}
    {exhibits.map((item, index) => <group key={index}>
      <mesh position={[item.position[0], .14, item.position[2]]} receiveShadow={shadows}><cylinderGeometry args={[1.7, 1.85, .7, 8]} /><meshStandardMaterial color="#263c48" roughness={.65} metalness={.4} /></mesh>
      <mesh position={[item.position[0], .51, item.position[2]]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[1.58, .025, 6, 48]} /><meshBasicMaterial color={index % 2 ? "#72b9ff" : "#63efd0"} /></mesh>
      <BorrowedModel {...item} footprint={2.8} shadows={shadows} />
    </group>)}
    {[-1, 1].map(side => <mesh key={side} position={[side * 5.8, .75, -3.8]}><boxGeometry args={[.09, 1.8, .09]} /><meshBasicMaterial color="#72b9ff" /></mesh>)}
  </>;
}
