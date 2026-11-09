import { expect, it } from "vitest";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { createAppearance, createWaveController } from "./shayna-rig.mjs";

it("layers timed agent expressions and raw values without losing user settings", () => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh();
  mesh.morphTargetDictionary = { smile: 0, brow: 1 };
  mesh.morphTargetInfluences = [0, 0];
  scene.add(mesh);
  const catalog = { hair: [], costumes: [], clips: [{ id: "smile", name: "smile",
    group: "eyes1", duration: 1, curves: [{path: "Body", attribute: "blendShape.smile", keys: [{time: 0, value: 100}]}] }] };
  const gltf = { scene, parser: { associations: new Map([[mesh, {meshes: 0}]]), json: { meshes: [{name: "Body"}] } } };
  const appearance = createAppearance(gltf as unknown as import("three/examples/jsm/loaders/GLTFLoader.js").GLTF, catalog);
  expect(appearance.setRaw("Body::smile", 0.25)).toBe(true);
  expect(appearance.setAgentExpression("smile", 1, 0.5, 2)).toBe(true);
  appearance.resetFrame(); appearance.apply(1.5);
  expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.625);
  appearance.resetFrame(); appearance.apply(3.1);
  expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.25);
  expect(appearance.setAgentRaw("Body::smile", 0.9, 4, 1)).toBe(true);
  expect(appearance.setAgentExpression("smile", 4, 0.5, 1)).toBe(true);
  appearance.clearAgentExpression();
  appearance.resetFrame(); appearance.apply(4.5);
  expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.9);
  appearance.resetFrame(); appearance.apply(5.1);
  expect(mesh.morphTargetInfluences[0]).toBeCloseTo(0.25);
  expect(appearance.rawValue("Body::smile")).toBe(0.25);
});

it("raises the wrist above the elbow and allows a cancelled layer to fade into the current base pose", () => {
  const root = new THREE.Group();
  const [upper, lower, hand, index, little, middle] = Array.from(
    { length: 6 },
    (_, i) => {
      const bone = new THREE.Bone();
      bone.name = `arm-${i}`;
      return bone;
    },
  );
  upper.position.set(-0.1, 0.95, 0);
  lower.position.set(-0.2, 0, 0);
  hand.position.set(-0.16, 0, 0);
  index.position.set(-0.04, 0, 0.025);
  little.position.set(-0.035, 0, -0.025);
  middle.position.set(-0.05, 0, 0);
  root.add(upper);
  upper.add(lower);
  lower.add(hand);
  hand.add(index, little, middle);
  root.updateMatrixWorld(true);
  const bones = {
    rightUpperArm: upper,
    rightLowerArm: lower,
    rightHand: hand,
    rightIndexProximal: index,
    rightLittleProximal: little,
    rightMiddleProximal: middle,
  };
  const wave = createWaveController({
    humanoid: {
      getNormalizedBoneNode: (name: keyof typeof bones) => bones[name],
    },
  } as unknown as VRM);
  const neutral = upper.quaternion.clone();
  wave.apply(1.5);
  root.updateMatrixWorld(true);
  expect(hand.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(
    lower.getWorldPosition(new THREE.Vector3()).y + 0.1,
  );
  const fullAngle = neutral.angleTo(upper.quaternion);
  upper.quaternion.copy(neutral);
  wave.apply(1.5, 0.5);
  expect(neutral.angleTo(upper.quaternion)).toBeGreaterThan(0);
  expect(neutral.angleTo(upper.quaternion)).toBeLessThan(fullAngle);
  upper.quaternion.copy(neutral);
  wave.apply(1.5, 0);
  expect(upper.quaternion.equals(neutral)).toBe(true);
  wave.apply(wave.duration + 1);
  expect(upper.quaternion.equals(neutral)).toBe(true);
});
