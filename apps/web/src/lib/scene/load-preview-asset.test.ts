import { expect, test } from "vitest";
import { Raycaster, SkinnedMesh, Vector3 } from "three";
import { loadPreviewAsset } from "./load-preview-asset";
import { disposeAsset } from "./asset-resources";
import { fiveJointFixture } from "./skin-fixture";

test("a fifth joint contributes its original weight to vertex positions and bounds", async () => {
  const asset = await loadPreviewAsset(fiveJointFixture());
  try {
    const mesh = asset.scene.children.find(object => object instanceof SkinnedMesh);
    expect(mesh).toBeInstanceOf(SkinnedMesh);
    if (!(mesh instanceof SkinnedMesh)) throw new Error("Fixture skin missing");
    expect(mesh.getVertexPosition(0, new Vector3()).toArray()).toEqual([2, 0, 0]);
    expect(mesh.getVertexPosition(1, new Vector3()).toArray()).toEqual([3, 0, 0]);
    mesh.computeBoundingBox();
    expect(mesh.boundingBox?.min.toArray()).toEqual([2, 0, 0]);
    const hits = new Raycaster(new Vector3(2.2, .2, 2), new Vector3(0, 0, -1)).intersectObject(mesh);
    expect(hits).toHaveLength(1);
    expect(hits[0].point.toArray()).toEqual([2.2, .2, 0]);
  } finally { disposeAsset(asset); }
});

test("unsupported third influence sets are refused instead of rendered with silently missing joints", async () => {
  await expect(loadPreviewAsset(fiveJointFixture({ JOINTS_2: 3, WEIGHTS_2: 4 })).then(asset => {
    disposeAsset(asset); return "accepted";
  })).rejects.toThrow("八个骨骼影响");
});

test.each(["JOINTS_1", "WEIGHTS_1", "WEIGHTS_0", "JOINTS_0"])("refuses incomplete skin pairs: missing %s", async key => {
  await expect(loadPreviewAsset(fiveJointFixture({ [key]: undefined })).then(asset => { disposeAsset(asset); return "accepted"; })).rejects.toThrow("配对");
});

test.each([-.5, 2, NaN, .2])("refuses invalid combined weights: %s", async secondWeight => {
  await expect(loadPreviewAsset(fiveJointFixture({}, { secondWeight })).then(asset => { disposeAsset(asset); return "accepted"; })).rejects.toThrow("权重");
});

test("rejects joints outside the actual skeleton", async () => {
  await expect(loadPreviewAsset(fiveJointFixture({}, { secondJoint: 5 })).then(asset => { disposeAsset(asset); return "accepted"; })).rejects.toThrow("骨骼索引");
});

test("ordinary four-influence files keep their existing position", async () => {
  const asset = await loadPreviewAsset(fiveJointFixture({ JOINTS_1: undefined, WEIGHTS_1: undefined }, { firstWeight: .25 }));
  try {
    const mesh = asset.scene.children.find(object => object instanceof SkinnedMesh);
    if (!(mesh instanceof SkinnedMesh)) throw new Error("Fixture skin missing");
    expect(mesh.getVertexPosition(0, new Vector3()).toArray()).toEqual([1, 0, 0]);
  } finally { disposeAsset(asset); }
});
