import * as THREE from "three";
import { VRMNodeConstraintManager } from "@pixiv/three-vrm";

export const clamp01 = (value) =>
  Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const canonical = (value) =>
  value
    .replace(/\.baked.*$/i, "")
    .replace(/[ ._]/g, "")
    .toLowerCase();
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Build the gesture in a copy of the actual normalized arm. No VRM-version
// angle signs, no stop/reset of the torso or the underlying idle animation.
export function createWaveController(vrm) {
  const names = [
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
    "rightIndexProximal",
    "rightLittleProximal",
    "rightMiddleProximal",
  ];
  const actual = Object.fromEntries(
    names.map((n) => [n, vrm.humanoid.getNormalizedBoneNode(n)]),
  );
  if (!actual.rightUpperArm || !actual.rightLowerArm || !actual.rightHand)
    throw new Error("缺少右臂骨骼");
  actual.rightUpperArm.updateWorldMatrix(true, true);
  const arm = actual.rightUpperArm.clone(true),
    parentWorld = actual.rightUpperArm.parent.getWorldQuaternion(
      new THREE.Quaternion(),
    );
  arm.position.copy(actual.rightUpperArm.getWorldPosition(new THREE.Vector3()));
  arm.quaternion.copy(
    actual.rightUpperArm.getWorldQuaternion(new THREE.Quaternion()),
  );
  const nodes = Object.fromEntries(
    names.map((n) => [
      n,
      n === "rightUpperArm"
        ? arm
        : arm.getObjectByName(actual[n]?.name ?? "__absent__"),
    ]),
  );
  const initial = new Map();
  arm.traverse((n) => initial.set(n, n.quaternion.clone()));
  const outward = actual.rightLowerArm
    .getWorldPosition(new THREE.Vector3())
    .sub(actual.rightUpperArm.getWorldPosition(new THREE.Vector3()));
  outward.y = 0;
  outward.z = 0;
  outward.normalize();
  const up = new THREE.Vector3(0, 1, 0),
    front = new THREE.Vector3(0, 0, 1);
  function orient(node, child, direction) {
    arm.updateWorldMatrix(true, true);
    const from = child
      .getWorldPosition(new THREE.Vector3())
      .sub(node.getWorldPosition(new THREE.Vector3()))
      .normalize();
    const world = new THREE.Quaternion()
      .setFromUnitVectors(from, direction.clone().normalize())
      .multiply(node.getWorldQuaternion(new THREE.Quaternion()));
    const parent = node.parent
      ? node.parent.getWorldQuaternion(new THREE.Quaternion())
      : new THREE.Quaternion();
    node.quaternion.copy(parent.invert().multiply(world));
    arm.updateWorldMatrix(true, true);
  }
  function target(time) {
    arm.traverse((n) => n.quaternion.copy(initial.get(n)));
    orient(
      arm,
      nodes.rightLowerArm,
      outward
        .clone()
        .multiplyScalar(0.78)
        .addScaledVector(up, -0.62)
        .addScaledVector(front, 0.06),
    );
    orient(
      nodes.rightLowerArm,
      nodes.rightHand,
      up
        .clone()
        .addScaledVector(outward, 0.1 + Math.sin(time * 7.5) * 0.14)
        .addScaledVector(front, 0.12),
    );
    const middle = nodes.rightMiddleProximal;
    const direction = up
      .clone()
      .addScaledVector(outward, Math.sin(time * 7.5) * 0.28)
      .normalize();
    if (middle) orient(nodes.rightHand, middle, direction);
    if (nodes.rightIndexProximal && nodes.rightLittleProximal) {
      const wrist = nodes.rightHand.getWorldPosition(new THREE.Vector3());
      const normal = nodes.rightIndexProximal
        .getWorldPosition(new THREE.Vector3())
        .sub(wrist)
        .cross(
          nodes.rightLittleProximal
            .getWorldPosition(new THREE.Vector3())
            .sub(wrist),
        )
        .projectOnPlane(direction)
        .normalize();
      const desired = front.clone().projectOnPlane(direction).normalize();
      if (normal.lengthSq() > 0.1) {
        const angle = Math.atan2(
          direction.dot(normal.clone().cross(desired)),
          normal.dot(desired),
        );
        const q = new THREE.Quaternion()
          .setFromAxisAngle(direction, angle)
          .multiply(nodes.rightHand.getWorldQuaternion(new THREE.Quaternion()));
        nodes.rightHand.quaternion.copy(
          nodes.rightHand.parent
            .getWorldQuaternion(new THREE.Quaternion())
            .invert()
            .multiply(q),
        );
      }
    }
    return {
      rightUpperArm: parentWorld.clone().invert().multiply(arm.quaternion),
      rightLowerArm: nodes.rightLowerArm.quaternion.clone(),
      rightHand: nodes.rightHand.quaternion.clone(),
    };
  }
  return {
    duration: 3.8,
    apply(time, opacity = 1) {
      const weight =
        smooth(0, 0.65, time) *
        (1 - smooth(3.05, 3.8, time)) *
        clamp01(opacity);
      if (weight <= 0) return false;
      const pose = target(time);
      for (const n of Object.keys(pose))
        actual[n].quaternion.slerp(pose[n], weight);
      return true;
    },
  };
}

export function configureShaynaRig(vrm) {
  const manager = vrm.springBoneManager;
  const garments = [...(manager?.joints ?? [])].filter((j) =>
    /^(jacket|armcloth)/.test(canonical(j.bone.name)),
  );
  manager?.reset();
  let reversed = 0;
  const cuffs = [];
  for (const old of [...(vrm.nodeConstraintManager?.constraints ?? [])]) {
    if (
      !/^hand[lr]$/.test(canonical(old.destination.name)) ||
      !/^armclothhand[lr]$/.test(canonical(old.source.name))
    )
      continue;
    // Free the hands. Let the cuff remain hanging while the wrist turns, rather
    // than rotating the whole long sleeve into the raised palm.
    vrm.nodeConstraintManager.deleteConstraint(old);
    reversed++;
  }
  vrm.nodeConstraintManager ??= new VRMNodeConstraintManager();
  vrm.scene.traverse((bone) => {
    const name = canonical(bone.name);
    if (!/^armclothhand[lr]$/.test(name)) return;
    const hips = vrm.humanoid.getRawBoneNode("hips"),
      hand = vrm.humanoid.getRawBoneNode(
        name.endsWith("l") ? "leftHand" : "rightHand",
      ),
      cuff = { bone, relative: null };
    cuffs.push(cuff);
    const follower = {
      destination: bone,
      source: hand,
      dependencies: new Set([hips]),
      setInitState() {},
      update() {
        if (!cuff.relative) return;
        const world = hips
          .getWorldQuaternion(new THREE.Quaternion())
          .multiply(cuff.relative);
        bone.quaternion.copy(
          bone.parent
            .getWorldQuaternion(new THREE.Quaternion())
            .invert()
            .multiply(world),
        );
        bone.updateMatrix();
        bone.updateWorldMatrix(false, true);
      },
    };
    vrm.nodeConstraintManager.addConstraint(follower);
  });
  let stable = true;
  function setStable(value) {
    stable = !!value;
    for (const j of garments) {
      if (stable) {
        j.reset();
        manager.deleteJoint(j);
      } else manager.addJoint(j);
    }
    manager?.reset();
  }
  setStable(true);
  return {
    setStable,
    calibrateCuffs() {
      for (const c of cuffs) {
        if (c.relative) continue;
        const origin = c.bone.getWorldPosition(new THREE.Vector3()),
          tip = new THREE.Vector3();
        let count = 0;
        c.bone.traverse((n) => {
          if (!n.children.length) {
            tip.add(n.getWorldPosition(new THREE.Vector3()));
            count++;
          }
        });
        const direction = tip
          .divideScalar(count || 1)
          .sub(origin)
          .normalize();
        const down = new THREE.Quaternion().setFromUnitVectors(
          direction,
          new THREE.Vector3(0, -1, 0),
        );
        const world = down.multiply(
          c.bone.getWorldQuaternion(new THREE.Quaternion()),
        );
        c.relative = vrm.humanoid
          .getRawBoneNode("hips")
          .getWorldQuaternion(new THREE.Quaternion())
          .invert()
          .multiply(world);
      }
    },
    get stable() {
      return stable;
    },
    garmentJoints: garments.length,
    reversedConstraints: reversed,
  };
}

export function sampleCurve(keys, time) {
  if (!keys.length) return 0;
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    if (time <= keys[i].time) {
      const a = keys[i - 1],
        b = keys[i],
        t = (time - a.time) / (b.time - a.time || 1);
      return a.value + (b.value - a.value) * t;
    }
  }
  return keys.at(-1).value;
}

export function createAppearance(gltf, catalog) {
  const meshes = [],
    bySource = new Map(),
    baseline = new Map();
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const association = gltf.parser.associations.get(object),
      schema = gltf.parser.json.meshes?.[association?.meshes];
    const source = schema?.name ?? object.name;
    meshes.push({ object, source });
    const key = canonical(source);
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(object);
    if (object.morphTargetInfluences)
      baseline.set(object, object.morphTargetInfluences.slice());
  });
  const find = (source) => bySource.get(canonical(source)) ?? [];
  const shapes = meshes.flatMap(({ object, source }) =>
    Object.keys(object.morphTargetDictionary ?? {})
      .filter((n) => !n.startsWith("==="))
      .map((name) => ({ key: source + "::" + name, source, name })),
  );
  const rawShapes = [...new Map(shapes.map((s) => [s.key, s])).values()];
  const selected = new Map(),
    raw = new Map(),
    agentRaw = new Map(),
    hair = Object.fromEntries(catalog.hair.map((h) => [h.id, 0]));
  let agentExpression = null;
  const clothing = Object.fromEntries(
    catalog.costumes.map((c) => [
      c.id,
      { available: c.meshes.some((n) => find(n).length), visible: true },
    ]),
  );
  function support(clip) {
    if (clip.reset) return { available: true, reason: "" };
    if (!clip.curves.length)
      return {
        available: false,
        reason:
          clip.name === "LipSync_Viseme"
            ? "口型绑定配置，由五元音／语音口型使用"
            : "原包空片段，无可显示的变化",
      };
    const hasBody = clip.curves.some((c) => c.path === "Body");
    const relevant = clip.curves.filter(
      (c) => !(c.path === "Face" && hasBody) && c.attribute !== "m_Active",
    );
    const missing = relevant.filter((c) =>
      c.attribute.startsWith("blendShape.")
        ? !find(c.path).some(
            (o) => c.attribute.slice(11) in (o.morphTargetDictionary ?? {}),
          )
        : c.attribute === "m_IsActive"
          ? !find(c.path).length
          : true,
    );
    return {
      available: !missing.length && !!relevant.length,
      reason: missing.length
        ? "当前 VRM 缺少：" +
          [
            ...new Set(
              missing.map(
                (c) => c.path + " / " + c.attribute.replace("blendShape.", ""),
              ),
            ),
          ]
            .slice(0, 4)
            .join("、")
        : "",
    };
  }
  function applyClip(clip, time, intensity = 1) {
    for (const curve of clip.curves) {
      const value = sampleCurve(curve.keys, time);
      for (const object of find(curve.path)) {
        if (curve.attribute.startsWith("blendShape.")) {
          const i = object.morphTargetDictionary?.[curve.attribute.slice(11)];
          if (i !== undefined)
            object.morphTargetInfluences[i] =
              object.morphTargetInfluences[i] * (1 - intensity) + clamp01(value / 100) * intensity;
        } else if (curve.attribute === "m_IsActive")
          object.visible = value >= 0.5;
      }
    }
  }
  function clearFace(preserveRaw = false) {
    selected.clear();
    if (!preserveRaw)
      for (const key of [...raw.keys()])
        if (canonical(key.split("::")[0]) === "body") raw.delete(key);
  }
  return {
    rawShapes,
    clothing,
    hair,
    support,
    clearFace,
    resetFrame() {
      for (const [o, weights] of baseline)
        o.morphTargetInfluences.set
          ? o.morphTargetInfluences.set(weights)
          : weights.forEach((v, i) => (o.morphTargetInfluences[i] = v));
    },
    choose(id, time) {
      const clip = catalog.clips.find((c) => c.id === id);
      if (!clip || !support(clip).available) return false;
      const g = clip.group;
      if (["combined", "legacy"].includes(g)) clearFace();
      else {
        selected.delete("combined");
        selected.delete("legacy");
      }
      const channel = g.startsWith("eyes")
        ? "eyes"
        : g.startsWith("mouth")
          ? "mouth"
          : g === "brows"
            ? /頬染め|青ざめ|瞳/.test(clip.name)
              ? clip.name
              : "brows"
            : g;
      selected.set(channel, { clip, time });
      return true;
    },
    setClothing(id, value) {
      const item = catalog.costumes.find((c) => c.id === id);
      if (!item || !clothing[id]?.available) return false;
      clothing[id].visible = !!value;
      for (const name of item.meshes)
        for (const object of find(name)) object.visible = !!value;
      return true;
    },
    setHair(id, value) {
      if (!(id in hair)) return false;
      const h = catalog.hair.find((h) => h.id === id),
        clip = catalog.clips.find(
          (c) => c.group === "hair" && c.name === h.clip,
        );
      if (!clip || !support(clip).available) return false;
      hair[id] = clamp01(value);
      return true;
    },
    setRaw(key, value) {
      if (!rawShapes.some((s) => s.key === key)) return false;
      raw.set(key, clamp01(value));
      return true;
    },
    setAgentExpression(id, time, intensity, duration) {
      const clip = catalog.clips.find((c) => c.id === id);
      if (!clip || !support(clip).available || clip.curves.some((c) => c.attribute === "m_IsActive")) return false;
      agentExpression = { clip, time, intensity: clamp01(intensity), until: time + duration };
      return true;
    },
    setAgentRaw(key, value, time, duration) {
      if (!rawShapes.some((s) => s.key === key)) return false;
      agentRaw.set(key, { value: clamp01(value), until: time + duration });
      return true;
    },
    clearAgentExpression() {
      agentExpression = null;
    },
    clearAgent() {
      agentExpression = null;
      agentRaw.clear();
    },
    rawValue(key) {
      return raw.get(key) ?? 0;
    },
    clearRaw() {
      raw.clear();
    },
    apply(time) {
      for (const h of catalog.hair) {
        const c = catalog.clips.find(
          (c) => c.group === "hair" && c.name === h.clip,
        );
        if (c && support(c).available) applyClip(c, hair[h.id] * c.duration);
      }
      for (const { clip, time: start } of selected.values()) {
        const t =
          clip.name === "Blink"
            ? (time - start) % Math.max(clip.duration, 0.001)
            : Math.max(0, time - start);
        applyClip(clip, t);
      }
      for (const [key, value] of raw) {
        const s = rawShapes.find((s) => s.key === key);
        for (const o of find(s.source)) {
          const i = o.morphTargetDictionary?.[s.name];
          if (i !== undefined) o.morphTargetInfluences[i] = value;
        }
      }
      if (agentExpression) {
        if (time >= agentExpression.until) agentExpression = null;
        else applyClip(agentExpression.clip, Math.max(0, time - agentExpression.time), agentExpression.intensity);
      }
      for (const [key, entry] of agentRaw) {
        if (time >= entry.until) { agentRaw.delete(key); continue; }
        const shape = rawShapes.find((s) => s.key === key);
        if (!shape) continue;
        for (const o of find(shape.source)) {
          const i = o.morphTargetDictionary?.[shape.name];
          if (i !== undefined) o.morphTargetInfluences[i] = entry.value;
        }
      }
    },
    reset() {
      this.clearAgent();
      clearFace();
      raw.clear();
      for (const id of Object.keys(hair)) hair[id] = 0;
      for (const id of Object.keys(clothing)) this.setClothing(id, true);
    },
    state() {
      return {
        clothing,
        hair,
        selected: [...selected.values()].map((x) => x.clip.id),
        raw: Object.fromEntries(raw),
        rawShapeCount: rawShapes.length,
      };
    },
  };
}
