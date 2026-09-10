/** Tiny self-contained glTF with a fifth joint translating the triangle by +1 X.
 * Vertex X starts at 1; four identity joints carry .125 each, fifth +2 carries .5.
 * Kept independent of the renderer implementation for unit and GPU evidence.
 */
export function fiveJointFixture(extraAttributes: Record<string, number | undefined> = {}, values: { firstWeight?: number; secondWeight?: number; secondJoint?: number } = {}): ArrayBuffer {
  const binary = new ArrayBuffer(180);
  new Float32Array(binary, 0, 9).set([1, 0, 0, 2, 0, 0, 1, 1, 0]);
  new Uint16Array(binary, 36, 12).set([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
  new Float32Array(binary, 60, 12).fill(values.firstWeight ?? .125);
  const joint = values.secondJoint ?? 4, weight = values.secondWeight ?? .5;
  new Uint16Array(binary, 108, 12).set([joint, 0, 0, 0, joint, 0, 0, 0, joint, 0, 0, 0]);
  new Float32Array(binary, 132, 12).set([weight, 0, 0, 0, weight, 0, 0, 0, weight, 0, 0, 0]);
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3, 4, 5] }], nodes: [{ mesh: 0, skin: 0 }, {}, {}, {}, {}, { translation: [2, 0, 0] }],
    skins: [{ joints: [1, 2, 3, 4, 5] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2, JOINTS_1: 3, WEIGHTS_1: 4, ...extraAttributes } }] }],
    buffers: [{ byteLength: 180 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 48 }, { buffer: 0, byteOffset: 108, byteLength: 24 }, { buffer: 0, byteOffset: 132, byteLength: 48 }],
    accessors: [{ bufferView: 0, componentType: 5126, type: "VEC3", count: 3, min: [1, 0, 0], max: [2, 1, 0] },
      { bufferView: 1, componentType: 5123, type: "VEC4", count: 3 }, { bufferView: 2, componentType: 5126, type: "VEC4", count: 3 },
      { bufferView: 3, componentType: 5123, type: "VEC4", count: 3 }, { bufferView: 4, componentType: 5126, type: "VEC4", count: 3 }],
  }));
  const padded = Math.ceil(json.length / 4) * 4;
  const output = new ArrayBuffer(28 + padded + binary.byteLength), view = new DataView(output);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, output.byteLength, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, padded).fill(32); new Uint8Array(output, 20, json.length).set(json);
  view.setUint32(20 + padded, binary.byteLength, true); view.setUint32(24 + padded, 0x004e4942, true);
  new Uint8Array(output, 28 + padded).set(new Uint8Array(binary));
  return output;
}
