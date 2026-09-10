import { expect, test } from "vitest";
import { BufferGeometry, Group, LineSegments, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshDistanceMaterial, Points, Texture } from "three";
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

test("clearing a skin also releases its custom shadow materials and shared textures once", () => {
  const scene = new Group(), texture = new Texture(), released: string[] = [];
  const surface = new MeshBasicMaterial({ map: texture });
  const mesh = new Mesh(new BufferGeometry(), surface);
  mesh.customDepthMaterial = new MeshDepthMaterial({ map: texture });
  mesh.customDistanceMaterial = new MeshDistanceMaterial({ map: texture });
  for (const [name, resource] of [["texture", texture], ["surface", surface], ["depth", mesh.customDepthMaterial], ["distance", mesh.customDistanceMaterial]] as const) {
    resource.addEventListener("dispose", () => released.push(name));
  }
  scene.add(mesh);
  disposeAsset({ scenes: [scene, scene] });
  expect(released.sort()).toEqual(["depth", "distance", "surface", "texture"]);
});
