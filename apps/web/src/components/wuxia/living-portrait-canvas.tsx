"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { LinearFilter, NoToneMapping, OrthographicCamera, PlaneGeometry, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader, Vector2 } from "three";
import { layerOffset, stageFraming, type PortraitPointer } from "@/lib/scene/living-portrait-motion";
import { CHARACTER_PLACEMENT, IDLE_RIG_GLSL, IdleRig } from "@/lib/scene/living-portrait-rig";

export type LivingCanvasProps = {
  active: boolean; intensity: number; parallax: boolean; resetRevision: number;
  pointer: MutableRefObject<PortraitPointer>; onReady: () => void; onError: () => void;
};
const plainVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const characterVertex = `varying vec2 vUv;
${IDLE_RIG_GLSL}
void main(){vUv=uv;vec3 p=position;
  vec2 d=idleMotion(vec2(position.x+835.,470.5-position.y)); p.xy+=vec2(d.x,-d.y);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
const characterFragment = `varying vec2 vUv;uniform sampler2D uImage;
void main(){vec4 color=texture2D(uImage,vUv);if(color.a<.003)discard;gl_FragColor=color;
  #include <colorspace_fragment>
}`;
const backgroundFragment = `varying vec2 vUv;uniform sampler2D uImage;uniform float uTime;uniform float uStrength;
void main(){vec2 p=vUv;float water=1.-smoothstep(.32,.46,p.y);
  p.x+=water*uStrength*.00065*sin(p.y*190.+uTime*1.1);
  p.y+=water*uStrength*.00025*sin(p.x*130.+uTime*.85);
  vec2 texel=vec2(1.3/1672.,1.3/941.);
  vec3 color=texture2D(uImage,p).rgb*.4;
  color+=(texture2D(uImage,p+vec2(texel.x,0.)).rgb+texture2D(uImage,p-vec2(texel.x,0.)).rgb
    +texture2D(uImage,p+vec2(0.,texel.y)).rgb+texture2D(uImage,p-vec2(0.,texel.y)).rgb)*.15;
  float mist=exp(-pow((vUv.y-.535)/.065,2.));
  float drift=sin(vUv.x*14.+uTime*.16)*sin(vUv.x*7.-uTime*.1);
  color=mix(color,vec3(.8,.84,.85),mist*.025*uStrength*(drift+1.));
  gl_FragColor=vec4(color,1.);
  #include <colorspace_fragment>
}`;

async function readTexture(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Scene asset unavailable");
  const blob = await response.blob(); signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const texture = await new TextureLoader().loadAsync(objectUrl);
    texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = LinearFilter;
    return texture;
  } finally { URL.revokeObjectURL(objectUrl); }
}
type SceneAssets = {
  background: ShaderMaterial; character: ShaderMaterial; boat: ShaderMaterial; bow: ShaderMaterial;
  plane: PlaneGeometry; mesh: PlaneGeometry; textures: Texture[];
};
function release(assets: SceneAssets) {
  for (const material of [assets.background, assets.character, assets.boat, assets.bow]) material.dispose();
  assets.plane.dispose(); assets.mesh.dispose(); for (const texture of assets.textures) texture.dispose();
}
function Layers(props: LivingCanvasProps) {
  const { camera, gl, size, invalidate } = useThree();
  const [assets, setAssets] = useState<SceneAssets>();
  const rig = useRef(new IdleRig()), smoothPointer = useRef({ x: 0, y: 0 }), frames = useRef(0);
  const backgroundRef = useRef<import("three").Mesh>(null), assemblyRef = useRef<import("three").Group>(null);
  const readySent = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false, owned: SceneAssets | undefined;
    void (async () => {
      const results = await Promise.allSettled(["environment.png", "boat.png", "character.png", "bow.png"].map(name => readTexture(`/scenes/wuxia/v2/${name}`, controller.signal)));
      const textures = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      if (cancelled || results.some(result => result.status === "rejected")) {
        textures.forEach(texture => texture.dispose()); if (!cancelled) props.onError(); return;
      }
      const base = { transparent: true, depthWrite: false, depthTest: false, toneMapped: false };
      owned = { textures, plane: new PlaneGeometry(1670, 941), mesh: new PlaneGeometry(1670, 941, 200, 120),
        background: new ShaderMaterial({ ...base, vertexShader: plainVertex, fragmentShader: backgroundFragment,
          uniforms: { uImage: { value: textures[0] }, uTime: { value: 0 }, uStrength: { value: 0 } } }),
        boat: new ShaderMaterial({ ...base, vertexShader: plainVertex, fragmentShader: characterFragment,
          uniforms: { uImage: { value: textures[1] } } }),
        bow: new ShaderMaterial({ ...base, vertexShader: plainVertex, fragmentShader: characterFragment,
          uniforms: { uImage: { value: textures[3] } } }),
        character: new ShaderMaterial({ ...base, vertexShader: characterVertex, fragmentShader: characterFragment,
          uniforms: { uImage: { value: textures[2] }, uBreath: { value: 0 }, uMotion: { value: rig.current.offsets.map(() => new Vector2()) } } }),
      };
      setAssets(owned); invalidate();
    })().catch(() => { if (!cancelled) props.onError(); });
    return () => { cancelled = true; controller.abort(); if (owned) release(owned); };
  }, [invalidate, props.onError]);
  useEffect(() => {
    const canvas = gl.domElement, lost = (event: Event) => { event.preventDefault(); props.onError(); };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, props.onError]);
  useEffect(() => {
    if (camera instanceof OrthographicCamera) {
      camera.left = -size.width / 2; camera.right = size.width / 2; camera.top = size.height / 2; camera.bottom = -size.height / 2;
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useEffect(() => { rig.current.reset(); smoothPointer.current = { x: 0, y: 0 }; invalidate(); }, [props.resetRevision, invalidate]);
  useEffect(() => { invalidate(); }, [props.active, props.intensity, props.parallax, invalidate]);
  useFrame((_, delta) => {
    if (!assets) return;
    const started = performance.now(); rig.current.advance(delta, props.intensity, props.active);
    const target = props.parallax ? props.pointer.current : { x: 0, y: 0 };
    if (props.active) {
      const blend = 1 - Math.exp(-Math.min(delta, .05) * 7);
      smoothPointer.current.x += (target.x - smoothPointer.current.x) * blend;
      smoothPointer.current.y += (target.y - smoothPointer.current.y) * blend;
    }
    const back = layerOffset("background", smoothPointer.current), front = layerOffset("foreground", smoothPointer.current);
    if (backgroundRef.current) backgroundRef.current.position.set(back.x, back.y, 0);
    if (assemblyRef.current) assemblyRef.current.position.set(front.x, front.y, 0);
    assets.background.uniforms.uTime.value = rig.current.time; assets.background.uniforms.uStrength.value = props.intensity;
    assets.character.uniforms.uBreath.value = rig.current.breath;
    const motion: Vector2[] = assets.character.uniforms.uMotion.value;
    rig.current.offsets.forEach((p, i) => motion[i].set(p.x, p.y));
    const canvas = gl.domElement;
    canvas.dataset.sceneTime = rig.current.time.toFixed(4); canvas.dataset.sceneBreath = rig.current.breath.toFixed(4);
    canvas.dataset.scenePhysicsMs = (performance.now() - started).toFixed(3);
    canvas.dataset.scenePointer = JSON.stringify(smoothPointer.current); canvas.dataset.sceneFrames = String(++frames.current);
    canvas.dataset.sceneResources = JSON.stringify(gl.info.memory);
    if (!readySent.current) { readySent.current = true; props.onReady(); }
    if (props.active) invalidate();
  });
  const frame = stageFraming(size.width, size.height), placement = CHARACTER_PLACEMENT;
  return assets ? <group scale={frame.scale} position-x={frame.x} dispose={null}>
    <mesh ref={backgroundRef} geometry={assets.plane} material={assets.background} renderOrder={0} />
    <group ref={assemblyRef}>
      <mesh geometry={assets.plane} material={assets.boat} renderOrder={1} />
      <mesh geometry={assets.mesh} material={assets.character} renderOrder={2} scale={placement.scale}
        position={[placement.x - (1 - placement.scale) * 835, (1 - placement.scale) * 470.5 - placement.y, 0]} />
      <mesh geometry={assets.plane} material={assets.bow} renderOrder={3} />
    </group>
  </group> : null;
}
export default function LivingPortraitCanvas(props: LivingCanvasProps) {
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    const update = () => setDpr(Math.min(window.devicePixelRatio || 1, matchMedia("(max-width: 600px)").matches ? 1 : 1.5));
    update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update);
  }, []);
  return <Canvas orthographic frameloop="demand" dpr={dpr} camera={{ position: [0, 0, 10], near: .1, far: 50 }}
    gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
    onCreated={({ gl }) => { gl.toneMapping = NoToneMapping; gl.outputColorSpace = SRGBColorSpace; gl.domElement.setAttribute("aria-hidden", "true"); }}>
    <Layers {...props} />
  </Canvas>;
}
