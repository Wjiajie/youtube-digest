"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
  type VRMExpressionPresetName,
  type VRMHumanBoneName,
} from "@pixiv/three-vrm";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const VRM_URL = "/vrm/avatar-sample.vrm";
const AUDIO_URL = "/audio/avatar-p0.wav";

type VrmModelProps = {
  speakRequest: number;
  blinkRequest: number;
  audioContextRef: { current: AudioContext | null };
  onReady: () => void;
  onSpeakingChange: (speaking: boolean) => void;
  onError: (message: string) => void;
  onFps: (fps: number) => void;
};

export function VrmModel({
  speakRequest,
  blinkRequest,
  audioContextRef,
  onReady,
  onSpeakingChange,
  onError,
  onFps,
}: VrmModelProps) {
  const gltf = useLoader(GLTFLoader, VRM_URL, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser));
  });
  const vrm = useMemo(() => gltf.userData.vrm as VRM, [gltf]);
  const camera = useThree((state) => state.camera);
  const elapsed = useRef(0);
  const blink = useRef({ next: 2.2, phase: -1 });
  const forcedBlink = useRef(0);
  const audio = useRef<{
    analyser: AnalyserNode;
    data: Float32Array<ArrayBuffer>;
    source: AudioBufferSourceNode | null;
  } | null>(null);
  const speaking = useRef(false);
  const expressionNames = useRef({ aa: "aa", ih: "ih", ou: "ou" });
  const fps = useRef({ frames: 0, last: performance.now() });

  useEffect(() => {
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((object) => {
      object.frustumCulled = false;
    });
    if (vrm.lookAt) vrm.lookAt.target = camera;

    const expressionMap = vrm.expressionManager?.expressionMap ?? {};
    expressionNames.current = {
      aa: expressionMap.aa ? "aa" : "a",
      ih: expressionMap.ih ? "ih" : "i",
      ou: expressionMap.ou ? "ou" : "u",
    };
    if (typeof window !== "undefined") {
      (window as unknown as { __avatarDebug?: unknown }).__avatarDebug = {
        expressions: Object.keys(expressionMap),
        meta: vrm.meta,
      };
    }

    const pose = (name: VRMHumanBoneName, x: number, y: number, z: number) => {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (node) node.rotation.set(x, y, z);
    };
    const isVrm0 = (vrm.meta as { metaVersion?: string }).metaVersion === "0";
    const arm = isVrm0 ? 1 : -1;
    pose("leftUpperArm", 0, 0, arm * 1.12);
    pose("rightUpperArm", 0, 0, -arm * 1.12);
    pose("leftLowerArm", 0, 0.12, arm * 0.14);
    pose("rightLowerArm", 0, -0.12, -arm * 0.14);
    pose("leftHand", 0, 0, arm * 0.08);
    pose("rightHand", 0, 0, -arm * 0.08);

    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = THREE.MathUtils.degToRad(20);
    const distance = (size.y / (2 * Math.tan(fov / 2))) * 1.45;
    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center.x, center.y, center.z);

    onReady();
  }, [vrm, camera, onReady]);

  useEffect(() => {
    if (blinkRequest > 0) forcedBlink.current = 1;
  }, [blinkRequest]);

  useEffect(() => {
    if (speakRequest === 0) return;
    let cancelled = false;

    const play = async () => {
      try {
        const ctx = audioContextRef.current;
        if (!ctx) throw new Error("Audio context is not ready");
        await ctx.resume();
        const response = await fetch(AUDIO_URL);
        if (!response.ok) throw new Error("Audio load failed: " + response.status);
        const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
        if (cancelled) return;

        if (!audio.current) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.75;
          analyser.connect(ctx.destination);
          audio.current = {
            analyser,
            data: new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT)),
            source: null,
          };
        }

        try {
          audio.current.source?.stop();
        } catch {
          // The previous source may already have ended.
        }

        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(audio.current.analyser);
        source.onended = () => {
          speaking.current = false;
          onSpeakingChange(false);
        };
        speaking.current = true;
        onSpeakingChange(true);
        source.start();
        audio.current.source = source;
      } catch (error) {
        speaking.current = false;
        onSpeakingChange(false);
        onError(error instanceof Error ? error.message : String(error));
      }
    };

    void play();
    return () => {
      cancelled = true;
    };
  }, [speakRequest, audioContextRef, onSpeakingChange, onError]);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const time = elapsed.current;

    const chest = vrm.humanoid.getNormalizedBoneNode("chest");
    if (chest) {
      const breathe = 1 + Math.sin(time * (Math.PI * 2 / 4.6)) * 0.008;
      chest.scale.set(breathe, breathe, breathe);
      chest.rotation.z = Math.sin(time * 0.55) * 0.012;
    }
    const hips = vrm.humanoid.getNormalizedBoneNode("hips");
    if (hips) hips.rotation.y = Math.sin(time * 0.4) * 0.035;

    const currentBlink = blink.current;
    if (forcedBlink.current > 0) {
      currentBlink.phase = 0;
      forcedBlink.current = 0;
    }
    currentBlink.next -= delta;
    if (currentBlink.next <= 0 && currentBlink.phase < 0) {
      currentBlink.phase = 0;
      currentBlink.next = 2.2 + Math.random() * 3.2;
    }
    if (currentBlink.phase >= 0) {
      currentBlink.phase += delta;
      const progress = Math.min(1, currentBlink.phase / 0.14);
      vrm.expressionManager?.setValue(
        "blink",
        progress < 0.5 ? progress * 2 : (1 - progress) * 2,
      );
      if (progress >= 1) currentBlink.phase = -1;
    }

    let weight = 0;
    if (speaking.current && audio.current) {
      audio.current.analyser.getFloatTimeDomainData(audio.current.data);
      let peak = 0;
      for (let i = 0; i < audio.current.data.length; i += 1) {
        peak = Math.max(peak, Math.abs(audio.current.data[i]));
      }
      weight = Math.min(1, peak * 12);
    }
    const now = performance.now() / 1000;
    const names = expressionNames.current;
    vrm.expressionManager?.setValue(
      names.aa as VRMExpressionPresetName,
      weight * (0.75 + 0.25 * Math.sin(now * 11)),
    );
    vrm.expressionManager?.setValue(
      names.ih as VRMExpressionPresetName,
      weight * 0.22 * Math.max(0, Math.sin(now * 8 + 1.2)),
    );
    vrm.expressionManager?.setValue(
      names.ou as VRMExpressionPresetName,
      weight * 0.18 * Math.max(0, Math.sin(now * 6 + 2.4)),
    );

    fps.current.frames += 1;
    const current = performance.now();
    if (current - fps.current.last >= 1000) {
      onFps(fps.current.frames);
      fps.current.frames = 0;
      fps.current.last = current;
    }

    vrm.update(delta);
  });

  return <primitive object={vrm.scene} dispose={null} />;
}
