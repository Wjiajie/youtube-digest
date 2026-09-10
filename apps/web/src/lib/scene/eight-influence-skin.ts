import { BufferAttribute, Float32BufferAttribute, Material, Matrix4, SkinnedMesh, Vector3, Vector4 } from "three";
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from "three/addons/loaders/GLTFLoader.js";
import { disposeAsset } from "./asset-resources";
import { useEightInfluenceMaterials } from "./eight-influence-material";

/** Private loader adapter: keep original weights before Three normalizes set 0. */
export function eightInfluenceSkin(parser: GLTFParser): GLTFLoaderPlugin {
  const originals = new Map<number, BufferAttribute>();
  let extended = false;
  return {
    name: "BLUEPRINT_eight_influences",
    async beforeRoot() {
      const ids = new Set<number>();
      for (const mesh of parser.json.meshes ?? []) for (const primitive of mesh.primitives) {
        const attributes: Record<string, number> = primitive.attributes;
        if (Object.keys(attributes).some(key => /^(JOINTS|WEIGHTS)_/.test(key) && !/^(JOINTS|WEIGHTS)_[01]$/.test(key))) {
          throw new Error("试装最多支持八个骨骼影响，不能静默裁剪额外权重。");
        }
        const hasSecond = attributes.WEIGHTS_1 !== undefined || attributes.JOINTS_1 !== undefined;
        if ([0, 1].some(set => (attributes[`JOINTS_${set}`] === undefined) !== (attributes[`WEIGHTS_${set}`] === undefined)) ||
          (hasSecond && attributes.WEIGHTS_0 === undefined)) throw new Error("蒙皮属性必须从第零组开始完整配对。");
        if (attributes.WEIGHTS_1 !== undefined) extended = true;
        for (const key of ["WEIGHTS_0", "WEIGHTS_1"]) if (attributes[key] !== undefined) ids.add(attributes[key]);
      }
      if (!extended) return;
      await Promise.all([...ids].map(async id => {
        const accessor = await parser.loadAccessor(id);
        const values = new Float32Array(accessor.count * accessor.itemSize);
        for (let i = 0; i < accessor.count; i++) for (let j = 0; j < accessor.itemSize; j++) values[i * accessor.itemSize + j] = accessor.getComponent(i, j);
        originals.set(id, new Float32BufferAttribute(values, accessor.itemSize));
      }));
      for (const mesh of parser.json.meshes ?? []) for (const primitive of mesh.primitives) {
        const attributes: Record<string, number> = primitive.attributes;
        if (attributes.WEIGHTS_0 === undefined) continue;
        const first = originals.get(attributes.WEIGHTS_0)!, second = originals.get(attributes.WEIGHTS_1);
        const count = parser.json.accessors[attributes.POSITION]?.count;
        for (const weights of [first, second]) if (weights && (weights.itemSize !== 4 || weights.count !== count)) throw new Error("蒙皮权重必须为逐顶点四分量。");
        for (let vertex = 0; vertex < first.count; vertex++) {
          let sum = 0;
          for (const weights of [first, second]) if (weights) for (let component = 0; component < 4; component++) {
            const value = weights.getComponent(vertex, component);
            if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("蒙皮权重必须有限且介于零和一之间。");
            sum += value;
          }
          // Accommodate integer accessor quantization, without renormalizing set 0.
          if (Math.abs(sum - 1) > .005) throw new Error("完整蒙皮权重总和必须为一。");
        }
      }
    },
    async afterRoot(asset: GLTF) {
      if (!extended) return;
      const visited = new Set<SkinnedMesh>();
      const patched = new WeakSet<Material>();
      try {
        for (const scene of asset.scenes) scene.traverse(object => {
          if (!(object instanceof SkinnedMesh) || visited.has(object)) return;
          visited.add(object);
          const reference = parser.associations.get(object);
          if (!reference || reference.meshes === undefined || !("primitives" in reference) || typeof reference.primitives !== "number") throw new Error("无法定位完整蒙皮数据。");
          const attributes: Record<string, number> = parser.json.meshes[reference.meshes].primitives[reference.primitives].attributes;
          const first = originals.get(attributes.WEIGHTS_0)!;
          const second = originals.get(attributes.WEIGHTS_1);
          object.geometry.setAttribute("skinWeight", first);
          object.geometry.setAttribute("bpSkinWeight1", second ?? new Float32BufferAttribute(new Float32Array(first.count * 4), 4));
          object.geometry.setAttribute("bpSkinIndex1", object.geometry.getAttribute("joints_1") ?? new Float32BufferAttribute(new Float32Array(first.count * 4), 4));
          for (const name of ["skinIndex", "bpSkinIndex1"]) {
            const indices = object.geometry.getAttribute(name);
            if (indices.itemSize !== 4 || indices.count !== first.count) throw new Error("骨骼索引必须为逐顶点四分量。");
            for (let vertex = 0; vertex < indices.count; vertex++) for (let component = 0; component < 4; component++) {
              const value = indices.getComponent(vertex, component);
              if (!Number.isInteger(value) || value < 0 || value >= object.skeleton.bones.length) throw new Error("骨骼索引超出实际骨架。");
            }
          }
          useEightBoneTransform(object);
          useEightInfluenceMaterials(object, patched);
        });
      } catch (error) { disposeAsset(asset); throw error; }
    },
  };
}

function useEightBoneTransform(mesh: SkinnedMesh) {
  const base = new Vector4(), result = new Vector4(), transformed = new Vector4(), matrix = new Matrix4();
  mesh.applyBoneTransform = <T extends Vector3 | Vector4>(index: number, target: T): T => {
    base.set(target.x, target.y, target.z, target instanceof Vector4 ? target.w : 1).applyMatrix4(mesh.bindMatrix);
    result.set(0, 0, 0, 0);
    for (const [joints, weights] of [["skinIndex", "skinWeight"], ["bpSkinIndex1", "bpSkinWeight1"]]) {
      const indices = mesh.geometry.getAttribute(joints), influence = mesh.geometry.getAttribute(weights);
      for (let component = 0; component < 4; component++) {
        const weight = influence.getComponent(index, component);
        if (weight === 0) continue;
        const bone = indices.getComponent(index, component);
        matrix.multiplyMatrices(mesh.skeleton.bones[bone].matrixWorld, mesh.skeleton.boneInverses[bone]);
        result.addScaledVector(transformed.copy(base).applyMatrix4(matrix), weight);
      }
    }
    // Keep the weighted homogeneous component until after inverse binding,
    // exactly as the GPU matrix does, including quantized near-unit sums.
    result.applyMatrix4(mesh.bindMatrixInverse);
    if (target instanceof Vector4) target.set(result.x, result.y, result.z, result.w);
    else target.set(result.x, result.y, result.z);
    return target;
  };
  // Animated bounds need a fresh pose; do not cull from a stale rest-pose sphere.
  mesh.frustumCulled = false;
  const raycast = mesh.raycast;
  mesh.raycast = (raycaster, intersections) => {
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    raycast.call(mesh, raycaster, intersections);
  };
}
