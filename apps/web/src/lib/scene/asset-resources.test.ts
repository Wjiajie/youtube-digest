import { expect, test } from "vitest";
import { BufferGeometry, Group, LineSegments, Mesh, MeshBasicMaterial, Points, Texture } from "three";
import { disposeAsset } from "./asset-resources";

test("clearing an accepted asset releases mesh, line and point resources and shared materials exactly once", () => {
  const scene = new Group();
  const texture = new Texture();
  const material = new MeshBasicMaterial({ map: texture });
  const released: string[] = [];
  texture.addEventListener("dispose", () => released.push("texture"));
  material.addEventListener("dispose", () => released.push("material"));
  for (const [kind, primitive] of [
    ["mesh", new Mesh(new BufferGeometry(), material)],
    ["line", new LineSegments(new BufferGeometry(), material)],
    ["points", new Points(new BufferGeometry(), material)],
  ] as const) {
    primitive.geometry.addEventListener("dispose", () => released.push(kind));
    scene.add(primitive);
  }
  disposeAsset({ scenes: [scene] });
  expect(released.sort()).toEqual(["line", "material", "mesh", "points", "texture"]);
});
