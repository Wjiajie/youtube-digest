import { expect, test } from "vitest";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeAsset } from "./asset-resources";
import { validatePreviewAsset } from "./preview-asset";

// Small GLB container built from the published glTF 2.0 layout, not a loader mock.
function glb(document: object, binary?: Uint8Array): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const length = Math.ceil(json.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + length + (binary ? 8 + binary.byteLength : 0));
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20).fill(0x20);
  new Uint8Array(bytes, 20, json.length).set(json);
  if (binary) {
    view.setUint32(20 + length, binary.byteLength, true);
    view.setUint32(24 + length, 0x004e4942, true);
    new Uint8Array(bytes, 28 + length).set(binary);
  }
  return bytes;
}

test("local preview accepts the binary GLB container used by environment assets", () => {
  expect(() => validatePreviewAsset(glb({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 }))).not.toThrow();
});

test("GLB cannot hide an external resource in a second JSON chunk", () => {
  const first = glb({ asset: { version: "2.0" } });
  const second = glb({ asset: { version: "2.0" }, images: [{ uri: "https://example.com/private.png" }] });
  const combined = new Uint8Array(first.byteLength + second.byteLength - 12);
  combined.set(new Uint8Array(first));
  combined.set(new Uint8Array(second, 12), first.byteLength);
  new DataView(combined.buffer).setUint32(8, combined.byteLength, true);
  expect(() => validatePreviewAsset(combined.buffer)).toThrow("数据块无效");
});

test("validated GLB binary geometry remains readable by the real Three loader", async () => {
  const binary = new Uint8Array(new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]).buffer);
  const data = glb({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 3, 0] }],
  }, binary);
  validatePreviewAsset(data);
  const asset = await new GLTFLoader().parseAsync(data, "");
  try {
    expect(new Box3().setFromObject(asset.scene).getSize(new Vector3()).toArray()).toEqual([2, 3, 0]);
  } finally { disposeAsset(asset); }
});

test("GLB embedded JSON follows the same no-external-resource policy", () => {
  for (const uri of ["https://example.com/private.png", "../texture.png", "file:///private.bin"]) {
    expect(() => validatePreviewAsset(glb({ asset: { version: "2.0" }, images: [{ uri }] }))).toThrow("外部资源");
  }
});

test.each([
  ["magic", 0, 0], ["version", 4, 1], ["total length", 8, 999999],
  ["unaligned JSON", 12, 1], ["missing JSON", 16, 0x004e4942],
] as const)("rejects an invalid GLB %s before parsing", (_label, offset, value) => {
  const data = glb({ asset: { version: "2.0" } });
  new DataView(data).setUint32(offset, value, true);
  expect(() => validatePreviewAsset(data)).toThrow("GLB");
});

test("rejects truncated, oversized and unsupported trailing binary chunks", () => {
  expect(() => validatePreviewAsset(new ArrayBuffer(8))).toThrow("GLB");
  expect(() => validatePreviewAsset(new ArrayBuffer(10 * 1024 * 1024 + 1))).toThrow("10 MB");
  const data = glb({ asset: { version: "2.0" } }, new Uint8Array(4));
  const view = new DataView(data);
  const offset = 20 + view.getUint32(12, true);
  view.setUint32(offset, 8, true);
  expect(() => validatePreviewAsset(data)).toThrow("GLB");
  view.setUint32(offset, 4, true);
  view.setUint32(offset + 4, 0x11111111, true);
  expect(() => validatePreviewAsset(data)).toThrow("GLB");
});

test("local preview rejects external resource references before a loader can request them", () => {
  for (const uri of ["https://example.com/model.bin", "../private.bin", "file:///private.bin"]) {
    expect(() => validatePreviewAsset(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri }] }))).toThrow("外部资源");
  }
});

test("preview accepts embedded glTF 2 but rejects malformed versions and oversized files", () => {
  expect(() => validatePreviewAsset('{"asset":{"version":"2.0"},"buffers":[{"uri":"data:application/octet-stream;base64,AAAA"}]}')).not.toThrow();
  expect(() => validatePreviewAsset('{"asset":{"version":"1.0"}}')).toThrow("glTF 2.0");
  expect(() => validatePreviewAsset(" ".repeat(10 * 1024 * 1024 + 1))).toThrow("10 MB");
});
