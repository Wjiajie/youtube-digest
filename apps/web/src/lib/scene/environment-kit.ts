import { Box3, LoadingManager, Mesh, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { validatePreviewAsset } from "./preview-asset";
import { disposeAsset } from "./asset-resources";

export type EnvironmentKit = { rockWide: GLTF; rockTall: GLTF; pine: GLTF; canopy: GLTF };
const sources = { rockWide: "rock_largeA.glb", rockTall: "rock_tallA.glb", pine: "tree_pineTallA.glb", canopy: "tree_plateau.glb" } as const;

/** The receiver owns these resources; renderers only borrow them. */
export function disposeEnvironmentKit(kit: EnvironmentKit) {
  disposeAsset({ scenes: Object.values(kit).flatMap(asset => asset.scenes) });
}

export async function loadEnvironmentKit(files: readonly File[]): Promise<EnvironmentKit> {
  if (files.length !== 4 || new Set(files.map(file => file.name)).size !== 4
    || Object.values(sources).some(name => !files.some(file => file.name === name))) {
    throw new Error("请选择指定的四个不重复 GLB 文件。");
  }
  if (files.reduce((bytes, file) => bytes + file.size, 0) > 10 * 1024 * 1024) throw new Error("环境文件合计不能超过 10 MB。");
  const loaded: GLTF[] = [];
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (!/^(data:|blob:)/.test(url)) throw new Error("试装禁止请求外部资源。");
    return url;
  });
  const loader = new GLTFLoader(manager);
  async function read(name: string) {
    const file = files.find(item => item.name === name);
    if (!file) throw new Error(`缺少 ${name}。`);
    const data = await file.arrayBuffer();
    validatePreviewAsset(data);
    const document = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, new DataView(data).getUint32(12, true))));
    if (document.skins?.length || document.animations?.length) throw new Error("此组合仅接受静态环境，不接受绑定或动画资产。");
    const asset = await loader.parseAsync(data, ""); loaded.push(asset);
    const size = new Box3().setFromObject(asset.scene).getSize(new Vector3());
    if (!size.toArray().every(Number.isFinite) || size.y <= 0) throw new Error("文件没有可显示的有效几何体。");
    asset.scene.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    return asset;
  }
  try {
    return { rockWide: await read(sources.rockWide), rockTall: await read(sources.rockTall), pine: await read(sources.pine), canopy: await read(sources.canopy) };
  } catch (error) {
    disposeAsset({ scenes: loaded.flatMap(asset => asset.scenes) });
    throw error;
  }
}
