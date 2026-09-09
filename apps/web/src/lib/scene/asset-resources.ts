import { BufferGeometry, Line, Material, Mesh, Points, Skeleton, SkinnedMesh, Texture } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

export function disposeAsset(asset: Pick<GLTF, "scenes">) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<Skeleton>();
  const bitmaps = new Set<ImageBitmap>();
  for (const scene of asset.scenes) scene.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof Line || object instanceof Points)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) {
        textures.add(value);
        if (typeof ImageBitmap !== "undefined" && value.source.data instanceof ImageBitmap) bitmaps.add(value.source.data);
      }
    }
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const resource of [...geometries, ...materials, ...textures, ...skeletons]) resource.dispose();
  for (const bitmap of bitmaps) bitmap.close();
}
