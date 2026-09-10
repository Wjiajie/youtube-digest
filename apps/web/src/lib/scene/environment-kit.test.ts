import { expect, test } from "vitest";
import { Box3, Mesh, Vector3 } from "three";
import { disposeEnvironmentKit, loadEnvironmentKit } from "./environment-kit";

const names = ["rock_largeA.glb", "rock_tallA.glb", "tree_pineTallA.glb", "tree_plateau.glb"];
// A real triangle GLB from the published container layout; no loader substitution.
function triangleFile(name: string, options: object = {}): File {
  const binary = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0,
    ...options, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 3, 0] }] }));
  const padded = Math.ceil(json.length / 4) * 4;
  const data = new ArrayBuffer(28 + padded + 36), view = new DataView(data);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, data.byteLength, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(data, 20, padded).fill(32); new Uint8Array(data, 20, json.length).set(json);
  view.setUint32(20 + padded, 36, true); view.setUint32(24 + padded, 0x004e4942, true);
  new Uint8Array(data, 28 + padded).set(new Uint8Array(binary.buffer));
  return new File([data], name);
}

test("four local GLBs are mapped to explicit environment roles without rewriting their geometry", async () => {
  const kit = await loadEnvironmentKit(names.map(name => triangleFile(name)).reverse());
  try {
    expect(Object.keys(kit).sort()).toEqual(["canopy", "pine", "rockTall", "rockWide"]);
    for (const asset of Object.values(kit)) expect(new Box3().setFromObject(asset.scene).getSize(new Vector3()).toArray()).toEqual([2, 3, 0]);
  } finally { disposeEnvironmentKit(kit); }
});

test("a kit rejects duplicate or extra files rather than silently choosing one", async () => {
  await expect(loadEnvironmentKit([...names.map(name => triangleFile(name)), triangleFile(names[0])])).rejects.toThrow("四个不重复");
  await expect(loadEnvironmentKit([...names.map(name => triangleFile(name)), triangleFile("extra.glb")])).rejects.toThrow("四个不重复");
  await expect(loadEnvironmentKit(names.slice(1).map(name => triangleFile(name)))).rejects.toThrow("四个不重复");
});

test("total local input is bounded before reading any selected file", async () => {
  const files = names.map(name => new File([new Uint8Array(3 * 1024 * 1024)], name));
  await expect(loadEnvironmentKit(files)).rejects.toThrow("合计不能超过 10 MB");
});

test("the static environment rejects animation and skin data rather than cloning a broken rig", async () => {
  for (const options of [{ animations: [{ name: "move", channels: [], samplers: [] }] }, { skins: [{ joints: [0] }] }]) {
    await expect(loadEnvironmentKit(names.map(name => triangleFile(name, options))).then(kit => { disposeEnvironmentKit(kit); return "accepted"; })).rejects.toThrow("仅接受静态环境");
  }
});

test("releasing a loaded kit disposes every held geometry and material", async () => {
  const kit = await loadEnvironmentKit(names.map(name => triangleFile(name)));
  let geometries = 0, materials = 0;
  for (const asset of Object.values(kit)) asset.scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.addEventListener("dispose", () => { geometries++; });
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.addEventListener("dispose", () => { materials++; });
  });
  disposeEnvironmentKit(kit);
  expect({ geometries, materials }).toEqual({ geometries: 4, materials: 4 });
});

test("external references and empty geometry cannot replace the environment", async () => {
  const files = names.map(name => triangleFile(name));
  files[3] = triangleFile(names[3], { images: [{ uri: "https://example.com/not-a-local-resource.png" }] });
  await expect(loadEnvironmentKit(files)).rejects.toThrow("外部资源");
  const bytes = await triangleFile(names[3]).arrayBuffer();
  // A flat ground triangle has no height, so it cannot be normalized as a tree.
  new Float32Array(bytes, bytes.byteLength - 36).set([0, 0, 0, 2, 0, 0, 0, 0, 3]);
  // POSITION min/max are a loader input; change them consistently with the data.
  const jsonLength = new DataView(bytes).getUint32(12, true);
  const text = new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)).replace('"max":[2,3,0]', '"max":[2,0,3]');
  new Uint8Array(bytes, 20, jsonLength).set(new TextEncoder().encode(text));
  files[3] = new File([bytes], names[3]);
  await expect(loadEnvironmentKit(files)).rejects.toThrow("有效几何体");
});
