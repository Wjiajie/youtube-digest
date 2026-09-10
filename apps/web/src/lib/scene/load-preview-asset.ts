import { LoadingManager } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { validatePreviewAsset } from "./preview-asset";
import { eightInfluenceSkin } from "./eight-influence-skin";

export async function loadPreviewAsset(data: string | ArrayBuffer) {
  validatePreviewAsset(data);
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (!/^(data:|blob:)/.test(url)) throw new Error("试装禁止请求外部资源。");
    return url;
  });
  return new GLTFLoader(manager).register(eightInfluenceSkin).parseAsync(data, "");
}
