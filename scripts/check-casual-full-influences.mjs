// Optional local evidence: inspect the pinned Blender full-influence study bytes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const file = readFileSync(".tools/asset-intake/quaternius-women/Casual.full-influence-study.glb");
const sha256 = createHash("sha256").update(file).digest("hex");
assert.equal(sha256, "7892fef0124addd693b11a5181743c718b61ef979f86e53800e7d26d39984d96");
const length = file.readUInt32LE(12), document = JSON.parse(file.subarray(20, 20 + length));
const binary = file.subarray(28 + length);
function rows(id) {
  const accessor = document.accessors[id], view = document.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  assert.equal(accessor.componentType, 5126); assert.ok(components);
  return Array.from({ length: accessor.count }, (_, vertex) => Array.from({ length: components }, (_, component) =>
    binary.readFloatLE((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + vertex * (view.byteStride ?? components * 4) + component * 4)));
}
let floatValues = 0, extendedPrimitives = 0, extraVertices = 0, maxInfluences = 0, maxSumError = 0;
for (let id = 0; id < document.accessors.length; id++) if (document.accessors[id].componentType === 5126) {
  for (const row of rows(id)) for (const value of row) { assert.ok(Number.isFinite(value)); floatValues++; }
}
for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
  const attributes = primitive.attributes;
  assert.ok(!Object.keys(attributes).some(key => /^(WEIGHTS|JOINTS)_[2-9]/.test(key)));
  const first = rows(attributes.WEIGHTS_0), second = attributes.WEIGHTS_1 === undefined ? undefined : rows(attributes.WEIGHTS_1);
  if (second) { assert.notEqual(attributes.JOINTS_1, undefined); extendedPrimitives++; }
  for (let vertex = 0; vertex < first.length; vertex++) {
    const weights = [...first[vertex], ...(second?.[vertex] ?? [])];
    assert.ok(weights.every(value => value >= 0 && value <= 1));
    const count = weights.filter(value => value > 0).length;
    maxInfluences = Math.max(maxInfluences, count);
    if (count > 4) extraVertices++;
    maxSumError = Math.max(maxSumError, Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1));
  }
}
// Source vertices have at most seven; Mirror merging produces eight before export.
assert.equal(maxInfluences, 8); assert.ok(extraVertices > 0); assert.ok(maxSumError < 1e-6);
assert.equal(document.animations.length, 24); assert.equal(document.skins[0].joints.length, 62);
console.log({ bytes: file.length, sha256, meshes: document.meshes.length,
  primitives: document.meshes.flatMap(mesh => mesh.primitives).length, animations: document.animations.length,
  bones: document.skins[0].joints.length, floatValues, extendedPrimitives, extraVertices, maxInfluences, maxSumError });
