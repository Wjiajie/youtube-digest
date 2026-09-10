import { Material, MeshBasicMaterial, MeshDepthMaterial, MeshDistanceMaterial, MeshStandardMaterial, RGBADepthPacking, SkinnedMesh } from "three";

/** Adapter-private: patch asset-owned materials, never renderer-global chunks. */
export function useEightInfluenceMaterials(mesh: SkinnedMesh, patched: WeakSet<Material>) {
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (!(material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial)) throw new Error("完整蒙皮试装不支持此自定义材质。");
    patchMaterial(material, patched);
  }
  mesh.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  mesh.customDistanceMaterial = new MeshDistanceMaterial();
  // Three copies the surface's map/alpha/side/displacement into these each draw.
  patchMaterial(mesh.customDepthMaterial, patched);
  patchMaterial(mesh.customDistanceMaterial, patched);
}

function patchMaterial(material: Material, patched: WeakSet<Material>) {
  if (patched.has(material)) return;
  patched.add(material);
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${previousKey}:blueprint-eight-influences-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    for (const chunk of ["common", "skinbase_vertex", "skinning_vertex"]) {
      if (!shader.vertexShader.includes(`#include <${chunk}>`)) throw new Error("Three 着色器不兼容完整蒙皮适配，请停止试装。");
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
#ifdef USE_SKINNING
attribute vec4 bpSkinIndex1;
attribute vec4 bpSkinWeight1;
#endif`)
      .replace("#include <skinbase_vertex>", `#include <skinbase_vertex>
#ifdef USE_SKINNING
mat4 bpSkinTransform = skinWeight.x * boneMatX + skinWeight.y * boneMatY
  + skinWeight.z * boneMatZ + skinWeight.w * boneMatW
  + bpSkinWeight1.x * getBoneMatrix(bpSkinIndex1.x)
  + bpSkinWeight1.y * getBoneMatrix(bpSkinIndex1.y)
  + bpSkinWeight1.z * getBoneMatrix(bpSkinIndex1.z)
  + bpSkinWeight1.w * getBoneMatrix(bpSkinIndex1.w);
bpSkinTransform = bindMatrixInverse * bpSkinTransform * bindMatrix;
#endif`)
      .replace("#include <skinnormal_vertex>", `
#ifdef USE_SKINNING
objectNormal = (bpSkinTransform * vec4(objectNormal, 0.0)).xyz;
#ifdef USE_TANGENT
objectTangent = (bpSkinTransform * vec4(objectTangent, 0.0)).xyz;
#endif
#endif`)
      .replace("#include <skinning_vertex>", `
#ifdef USE_SKINNING
transformed = (bpSkinTransform * vec4(transformed, 1.0)).xyz;
#endif`);
  };
  material.needsUpdate = true;
}
