import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import catalog from "@/lib/companion/shayna-catalog.json";
import { avatarControlSchema, normalizeAvatarCapabilities, type AvatarCapabilitiesSnapshot, type AvatarAgentAdapter } from "@/lib/companion/avatar-capabilities";
import { createAvatarView } from "./avatar-view";
import {
  avatarCueSchema,
  type AvatarCue,
  type CompanionPreferences,
} from "@/lib/companion/contracts";
import {
  configureShaynaRig,
  createAppearance,
  createWaveController,
} from "./shayna-rig.mjs";

export type AvatarCapabilities = {
  expressions: Array<{
    id: string;
    label: string;
    available: boolean;
    reason: string;
    group?: string;
  }>;
  raw: Array<{ key: string; name: string }>;
  clothing: Record<string, { available: boolean; visible: boolean }>;
  motions: string[];
};
export interface AvatarController extends AvatarAgentAdapter {
  getCapabilities(): AvatarCapabilities;
  setAppearance(value: CompanionPreferences): Promise<void>;
  setExpression(id: string, intensity?: number, duration?: number): boolean;
  playMotion(id: "idle" | "wave" | "stand"): void;
  stopMotion(): void;
  reset(): void;
  cue(cue: AvatarCue, turn: number): void;
  setTurn(turn: number): void;
  setLipLevel(value: number): void;
  zoomView(factor: number): void;
  resetView(): void;
  dispose(): void;
}

/** Owns its WebGL resources and accepts semantic commands, never arbitrary script or bone IDs. */
export function createAvatarController(
  host: HTMLElement,
  onStatus: (status: string, caps?: AvatarCapabilities) => void,
  reservedBottom = 160,
): AvatarController {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Shayna 全身虚拟管家");
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(32, 1, 0.02, 50);
  const view = createAvatarView(camera, renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xf5f4ff, 0x6c7780, 1.5));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.7);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa4dce5, 1);
  rim.position.set(2, 2, -2);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.5, 80),
    new THREE.MeshBasicMaterial({
      color: 0x849eac,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  loader.register((p) => new VRMAnimationLoaderPlugin(p));
  let vrm: VRM | undefined,
    mixer: THREE.AnimationMixer | undefined,
    idle: THREE.AnimationAction | undefined;
  let appearance: ReturnType<typeof createAppearance> | undefined,
    wave: ReturnType<typeof createWaveController> | undefined;
  let agentSnapshot: AvatarCapabilitiesSnapshot | null = null;
  let variant = "",
    elapsed = 0,
    waveAt = -Infinity,
    waveCancelAt: number | undefined,
    expression = "neutral",
    weight = 0,
    targetWeight = 0,
    expressionUntil = 0,
    lip = 0,
    motion = "idle",
    turn = 0,
    loadToken = 0,
    disposed = false,
    raf = 0,
    last = performance.now();
  let bounds = new THREE.Box3(
    new THREE.Vector3(-0.5, 0, -0.4),
    new THREE.Vector3(0.5, 1.6, 0.4),
  );
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function fit(reset = false) {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    view.fit(bounds, w, h, reservedBottom, reset);
    host.dataset.fullBody = "true";
  }
  function pose(owner: VRM) {
    const sign = owner.meta.metaVersion === "0" ? 1 : -1;
    for (const [name, z] of [
      ["leftUpperArm", sign * 1.15],
      ["rightUpperArm", -sign * 1.15],
      ["leftLowerArm", sign * 0.1],
      ["rightLowerArm", -sign * 0.1],
    ] as const)
      owner.humanoid.getNormalizedBoneNode(name)?.rotation.set(0, 0, z);
  }
  function caps(): AvatarCapabilities {
    return {
      expressions: [
        ...(
          [
            "neutral",
            "happy",
            "sad",
            "angry",
            "relaxed",
            "surprised",
            "blink",
            "aa",
            "ih",
            "ou",
            "ee",
            "oh",
            "blinkLeft",
            "blinkRight",
            "lookUp",
            "lookDown",
            "lookLeft",
            "lookRight",
          ] as const
        ).map((id) => ({
          id,
          group: ["aa", "ih", "ou", "ee", "oh"].includes(id)
            ? "visemes"
            : [
                  "blinkLeft",
                  "blinkRight",
                  "lookUp",
                  "lookDown",
                  "lookLeft",
                  "lookRight",
                ].includes(id)
              ? "gaze"
              : "preset",
          label: {
            neutral: "中性",
            happy: "开心",
            sad: "难过",
            angry: "生气",
            relaxed: "放松",
            surprised: "惊讶",
            blink: "闭眼",
            aa: "啊",
            ih: "咿",
            ou: "呜",
            ee: "诶",
            oh: "哦",
            blinkLeft: "左眼眨眼",
            blinkRight: "右眼眨眼",
            lookUp: "向上看",
            lookDown: "向下看",
            lookLeft: "向左看",
            lookRight: "向右看",
          }[id],
          available:
            id === "neutral" || !!vrm?.expressionManager?.getExpression(id),
          reason: "当前版本未提供此表情",
        })),
        ...catalog.clips
          .filter(
            (c) =>
              !(["costume", "hair", "setup"] as string[]).includes(c.group),
          )
          .map((c) => ({
            id: c.id,
            group: c.group,
            label: c.label,
            ...(appearance?.support(c) ?? {
              available: false,
              reason: "角色尚未加载",
            }),
          })),
      ],
      raw: appearance?.rawShapes ?? [],
      clothing: appearance?.clothing ?? {},
      motions: ["idle", "wave", "stand"],
    };
  }
  function buildAgentSnapshot(): AvatarCapabilitiesSnapshot | null {
    if (!vrm || !appearance || !variant || disposed) return null;
    const info = caps();
    const controls: AvatarCapabilitiesSnapshot["controls"] = [];
    const add = (kind: AvatarCapabilitiesSnapshot["controls"][number]["kind"], id: string, label: string) => {
      const clean = label.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
      if (id.length > 0 && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id) && clean && controls.length < 256)
        controls.push({ kind, id, label: clean });
    };
    for (const expression of info.expressions) {
      if (!expression.available || ["visemes", "mouth1", "mouth2"].includes(expression.group ?? "")) continue;
      const clip = catalog.clips.find((c) => c.id === expression.id);
      if (clip?.curves.some((curve) => curve.attribute === "m_IsActive")) continue;
      add("expression", expression.id, expression.label);
    }
    for (const id of info.motions) {
      if (id === "wave" && reduced) continue;
      add("motion", id, ({ idle: "待机", wave: "挥手", stand: "站立" } as Record<string, string>)[id] ?? id);
    }
    for (const [id, option] of Object.entries(info.clothing))
      if (option.available) add("clothing", id, catalog.costumes.find((c) => c.id === id)?.label ?? id);
    for (const hair of catalog.hair) {
      const clip = catalog.clips.find((c) => c.group === "hair" && c.name === hair.clip);
      if (clip && appearance.support(clip).available) add("hair", hair.id, hair.label ?? hair.id);
    }
    for (const shape of info.raw) {
      // Speech controls these mouth channels; they must never be agent tools.
      if (/^(?:aa|ih|ou|ee|oh|あ|い|う|え|お)$/i.test(shape.name) || /mouth|lip|口|唇|嘴/i.test(shape.name)) continue;
      add("raw", shape.key, shape.name);
    }
    return normalizeAvatarCapabilities({ revision: crypto.randomUUID(), modelId: variant, controls });
  }
  const controller: AvatarController = {
    getCapabilities: caps,
    getAgentCapabilities() {
      return agentSnapshot ? { ...agentSnapshot, controls: agentSnapshot.controls.map((c) => ({ ...c })) } : null;
    },
    applyAgentControl(value, ownerTurn) {
      if (!agentSnapshot || disposed || ownerTurn !== turn || !appearance) return false;
      const parsed = avatarControlSchema(agentSnapshot).safeParse(value);
      if (!parsed.success) return false;
      const cue = parsed.data;
      if (cue.kind === "motion") { controller.playMotion(cue.id as "idle" | "wave" | "stand"); return true; }
      if (cue.kind === "clothing") return appearance.setClothing(cue.id, cue.value as boolean);
      if (cue.kind === "hair") return appearance.setHair(cue.id, cue.value as number);
      if (cue.kind === "raw") return appearance.setAgentRaw(cue.id, cue.value as number, elapsed, cue.duration ?? 4);
      const clip = catalog.clips.find((c) => c.id === cue.id);
      if (clip) {
        targetWeight = 0;
        return appearance.setAgentExpression(cue.id, elapsed, cue.value as number, cue.duration ?? 4);
      }
      if (cue.id !== "neutral" && !vrm?.expressionManager?.getExpression(cue.id)) return false;
      appearance.clearAgentExpression();
      expression = cue.id;
      targetWeight = cue.value as number;
      expressionUntil = elapsed + (cue.duration ?? 4);
      return true;
    },
    async setAppearance(value) {
      const profile = catalog.variants.find((v) => v.id === value.variant);
      if (!profile) { agentSnapshot = null; ++loadToken; throw new Error("不支持的 Shayna 形象"); }
      const token = ++loadToken;
      if (variant !== profile.id) {
        agentSnapshot = null;
        onStatus("正在迎接 Shayna…");
        const gltf = await loader.loadAsync(profile.url),
          next = gltf.userData.vrm as VRM | undefined;
        if (!next) throw new Error("资源缺少 VRM 数据");
        if (disposed || token !== loadToken) {
          VRMUtils.deepDispose(next.scene);
          return;
        }
        VRMUtils.rotateVRM0(next);
        const nextRig = configureShaynaRig(next),
          nextAppearance = createAppearance(gltf, catalog),
          nextWave = createWaveController(next);
        pose(next);
        next.update(0);
        const nextMixer = new THREE.AnimationMixer(next.scene);
        let nextIdle: THREE.AnimationAction | undefined;
        try {
          const animation = await loader.loadAsync(
            "/api/companion/assets?id=idle",
          );
          if (animation.userData.vrmAnimations?.[0])
            nextIdle = nextMixer
              .clipAction(
                createVRMAnimationClip(
                  animation.userData.vrmAnimations[0],
                  next,
                ),
              )
              .play();
        } catch {
          /* Standing/breathing remains available when the optional idle is absent. */
        }
        if (disposed || token !== loadToken) {
          VRMUtils.deepDispose(next.scene);
          return;
        }
        nextMixer.update(0);
        next.update(0);
        nextRig.calibrateCuffs();
        next.springBoneManager?.reset();
        for (let i = 0; i < 100; i++) {
          nextMixer.update(1 / 60);
          next.update(1 / 60);
        }
        mixer?.stopAllAction();
        if (vrm) {
          scene.remove(vrm.scene);
          mixer?.uncacheRoot(vrm.scene);
          VRMUtils.deepDispose(vrm.scene);
        }
        vrm = next;
        mixer = nextMixer;
        idle = nextIdle;
        appearance = nextAppearance;
        wave = nextWave;
        variant = profile.id;
        scene.add(vrm.scene);
        if (vrm.lookAt) vrm.lookAt.target = camera;
        bounds = new THREE.Box3().setFromObject(vrm.scene, true);
        floor.position.y = bounds.min.y - 0.015;
        waveAt = -Infinity;
        expression = "neutral";
        fit(true);
      }
      appearance!.reset();
      for (const [id, v] of Object.entries(value.clothing))
        appearance!.setClothing(id, v);
      for (const [id, v] of Object.entries(value.hair))
        appearance!.setHair(id, v);
      for (const [id, v] of Object.entries(value.raw))
        appearance!.setRaw(id, v);
      agentSnapshot ??= buildAgentSnapshot();
      host.dataset.avatarReady = "true";
      host.dataset.variant = variant;
      onStatus("", caps());
    },
    setExpression(id, intensity = 0.7, duration = 4) {
      if (
        !Number.isFinite(intensity) ||
        intensity < 0 ||
        intensity > 1 ||
        !Number.isFinite(duration) ||
        duration < 0.2 ||
        duration > 30
      )
        return false;
      const clip = catalog.clips.find((c) => c.id === id);
      if (clip) {
        appearance?.clearFace(true);
        appearance?.clearAgent();
        return appearance?.choose(id, elapsed) ?? false;
      }
      if (id !== "neutral" && !vrm?.expressionManager?.getExpression(id))
        return false;
      appearance?.clearFace();
      expression = id;
      targetWeight = intensity;
      expressionUntil = elapsed + duration;
      return true;
    },
    playMotion(id) {
      if (!["idle", "wave", "stand"].includes(id)) return;
      if (id === "idle" && motion === "wave") {
        controller.stopMotion();
        return;
      }
      motion = id;
      if (id === "wave") {
        idle?.play();
        waveAt = elapsed;
        waveCancelAt = undefined;
      } else {
        waveAt = -Infinity;
        waveCancelAt = undefined;
        if (id === "stand") idle?.stop();
        else idle?.play();
      }
    },
    stopMotion() {
      if (motion === "wave" && Number.isFinite(waveAt) && !reduced) {
        waveCancelAt ??= elapsed;
        idle?.play();
        return;
      }
      waveAt = -Infinity;
      waveCancelAt = undefined;
      motion = "idle";
      idle?.play();
    },
    reset() {
      appearance?.reset();
      expression = "neutral";
      targetWeight = 0;
      controller.stopMotion();
    },
    cue(value, ownerTurn) {
      if (ownerTurn !== turn) return;
      const parsed = avatarCueSchema.safeParse(value);
      if (!parsed.success) return;
      const cue = parsed.data;
      if (cue.kind === "motion") controller.playMotion(cue.id);
      else controller.setExpression(cue.id, cue.intensity, cue.duration);
    },
    setTurn(value) {
      if (value !== turn) {
        turn = value;
        controller.stopMotion();
        appearance?.clearFace(true);
        appearance?.clearAgent();
        targetWeight = 0;
      }
    },
    setLipLevel(value) {
      lip = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
    },
    zoomView(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      const offset = camera.position.clone().sub(view.controls.target);
      camera.position.copy(view.controls.target).add(offset.setLength(
        THREE.MathUtils.clamp(offset.length() * factor, view.controls.minDistance, view.controls.maxDistance),
      ));
      view.update();
    },
    resetView() { fit(true); },
    dispose() {
      disposed = true;
      agentSnapshot = null;
      loadToken++;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
      view.dispose();
      mixer?.stopAllAction();
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  function tick(now: number) {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.04);
    last = now;
    elapsed += dt;
    if (vrm && appearance) {
      if (reduced) {
        pose(vrm);
      } else {
        mixer?.update(dt);
        if (!idle?.isRunning()) {
          pose(vrm);
          const chest = vrm.humanoid.getNormalizedBoneNode("chest");
          if (chest) chest.rotation.z = Math.sin(elapsed * 1.4) * 0.008;
        }
      }
      if (motion === "wave" && wave && !reduced) {
        const age = elapsed - waveAt;
        const opacity =
          waveCancelAt === undefined
            ? 1
            : Math.max(0, 1 - (elapsed - waveCancelAt) / 0.2);
        if (age < wave.duration && opacity > 0) wave.apply(age, opacity);
        else {
          motion = "idle";
          waveAt = -Infinity;
          waveCancelAt = undefined;
        }
      }
      appearance.resetFrame();
      if (elapsed > expressionUntil) targetWeight = 0;
      weight = THREE.MathUtils.damp(weight, targetWeight, 8, dt);
      const em = vrm.expressionManager;
      if (em) {
        for (const e of em.expressions)
          em.setValue(
            e.expressionName,
            e.expressionName === expression ? weight : 0,
          );
        if (!expression.startsWith("blink") || elapsed > expressionUntil)
          em.setValue(
            "blink",
            Math.max(0, Math.sin(((elapsed % 4.3) / 0.17) * Math.PI)) *
              (elapsed % 4.3 < 0.17 ? 1 : 0),
          );
        if (lip > 0.001) {
          em.setValue("aa", lip * 0.85);
          em.setValue("ih", lip * 0.12);
        }
      }
      if (vrm.lookAt)
        vrm.lookAt.autoUpdate = !(
          expression.startsWith("look") && elapsed < expressionUntil
        );
      vrm.update(dt);
      appearance.apply(elapsed);
      // Speech owns mouth channels even while a native face clip is being previewed.
      if (lip > 0.001)
        vrm.scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences)
            return;
          for (const [name, value] of [
            ["あ", lip * 0.85],
            ["い", lip * 0.12],
            ["う", 0],
            ["え", 0],
            ["お", 0],
          ] as const) {
            const index = mesh.morphTargetDictionary[name];
            if (index !== undefined) mesh.morphTargetInfluences[index] = value;
          }
        });
    }
    view.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  const resize = () => fit();
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  window.visualViewport?.addEventListener("resize", resize);
  fit();
  raf = requestAnimationFrame(tick);
  return controller;
}
