// A narrowly scoped, offline derivation for the acquired Quaternius B1 sample.
// Original files stay untouched. This is not a general glTF importer.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const directory = resolve(".tools/asset-intake/quaternius-nature");
const original = await readFile(resolve(directory, "BirchTree_1.gltf"));
assert.equal(createHash("sha256").update(original).digest("hex"), "8dbf9fd8b6402bfffdbe370a8c4337e8dae27fa3da5fbacbfd4fae6482ad50fa");
const document = JSON.parse(original.toString());
assert.equal(document.buffers.length, 1);
assert.equal(document.buffers[0].uri, "BirchTree_1.bin");
assert.equal(document.images.length, 3);
assert.equal(document.images[0].uri, "BirchTree_Bark_Normal.png");
assert.deepEqual(document.textures.map(texture => texture.source), [0, 1, 2]);
assert.equal(document.materials[0].normalTexture.index, 0);
assert.deepEqual(document.materials.map(material => material.pbrMetallicRoughness.baseColorTexture.index), [1, 2]);
// The original 16-bit normal map is 22.7 MB by itself. This explicitly named
// base-color-only study does not downsample or overwrite that source texture.
delete document.materials[0].normalTexture;
for (const material of document.materials) material.pbrMetallicRoughness.baseColorTexture.index--;
document.images.shift(); document.textures.shift();
for (const texture of document.textures) texture.source--;
const inputs = [
  [document.buffers[0], "BirchTree_1.bin", "application/octet-stream", "a1b14d1c82ebb8153991de4156b77ceaa1143d64469679147c0ee249c8b90b83"],
  [document.images[0], "BirchTree_Bark.jpg", "image/jpeg", "f796f02e47bc5afddd17dc2385bbef53a352628ceb348deb1188ef04fe5deff9"],
  [document.images[1], "BirchTree_Leaves.png", "image/png", "8b674a02017d987f8ec0448bd2a52ad788d1235f91b7f00499b4ca071f8e69fe"],
];
for (const [entry, name, mime, expectedHash] of inputs) {
  assert.equal(entry.uri, name);
  const bytes = await readFile(resolve(directory, name));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  entry.uri = `data:${mime};base64,${bytes.toString("base64")}`;
}
document.asset.extras = { blueprintStudy: "Base color only; bark normal map omitted; original geometry, UVs and alpha retained; not final art." };
const output = JSON.stringify(document);
assert.ok(Buffer.byteLength(output) < 10 * 1024 * 1024);
const filename = "BirchTree_1.base-color-study.gltf";
await writeFile(resolve(directory, filename), output);
console.log(JSON.stringify({ filename, bytes: Buffer.byteLength(output), sha256: createHash("sha256").update(output).digest("hex"), omitted: "bark normal map", originalFilesUnchanged: true }));
