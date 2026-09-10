// Real WebGL oracle for the public asset loader; no app route or shader inspection.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const output = resolve(".goal-loop/evidence/eight-skin");
const entry = String.raw`
import * as THREE from "three";
import { loadPreviewAsset } from "./apps/web/src/lib/scene/load-preview-asset.ts";
import { disposeAsset } from "./apps/web/src/lib/scene/asset-resources.ts";
import { fiveJointFixture } from "./apps/web/src/lib/scene/skin-fixture.ts";

const canvas = document.querySelector("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setSize(384, 384); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x131923);
const gl = renderer.getContext(), debug = gl.getExtension("WEBGL_debug_renderer_info");
const rendererName = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
const shaderErrors = [];
renderer.debug.onShaderError = (context, program, vertex, fragment) => {
  shaderErrors.push([context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)]);
};
function difference(left, right) {
  let total = 0, changed = 0, maximum = 0;
  for (let i = 0; i < left.length; i += 4) {
    let pixel = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(left[i + channel] - right[i + channel]);
      total += delta; pixel = Math.max(pixel, delta); maximum = Math.max(maximum, delta);
    }
    if (pixel > 8) changed++;
  }
  return { meanAbsolute: total / (left.length / 4 * 3), changedPixels: changed, maximum };
}
async function render(mode, angle, lightKind, shadows = true) {
  const asset = await loadPreviewAsset(fiveJointFixture());
  let skinned; asset.scene.traverse(object => { if (object.isSkinnedMesh) skinned = object; });
  skinned.geometry.computeVertexNormals();
  skinned.skeleton.bones[4].rotation.y = angle;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2.4, 2.4, 2.4, -2.4, .1, 30);
  camera.position.set(2, .5, 8); camera.lookAt(2, .5, 0);
  // Smooth normals force lighting to use the transformed normal attribute.
  // Flat derivative normals would conceal a missing skin-normal shader path.
  const materialSettings = { color: 0x76a8d1, roughness: .72, metalness: 0, side: THREE.DoubleSide, flatShading: false };
  let subject, referenceGeometry, referenceMaterial;
  if (mode === "loaded") {
    subject = skinned;
    for (const material of Array.isArray(skinned.material) ? skinned.material : [skinned.material]) material.setValues(materialSettings);
    scene.add(asset.scene);
  } else {
    // Independent oracle: A = .5 I + .5 R_y(angle), then translate +1 X.
    // The fixture has equal weights at every vertex; no renderer skin API is used.
    const positions = [1, 0, 0, 2, 0, 0, 1, 1, 0];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], z = positions[i + 2];
      if (mode !== "unmoved") {
        positions[i] = .5 * x + .5 * (Math.cos(angle) * x + Math.sin(angle) * z) + 1;
        positions[i + 2] = .5 * z + .5 * (-Math.sin(angle) * x + Math.cos(angle) * z);
      }
    }
    referenceGeometry = new THREE.BufferGeometry();
    referenceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    referenceGeometry.computeVertexNormals();
    referenceMaterial = new THREE.MeshStandardMaterial(materialSettings);
    subject = new THREE.Mesh(referenceGeometry, referenceMaterial); scene.add(subject);
  }
  subject.castShadow = shadows; subject.frustumCulled = false;
  const receiverGeometry = new THREE.PlaneGeometry(12, 12);
  const receiverMaterial = new THREE.MeshStandardMaterial({ color: 0xb3b0a5, roughness: 1 });
  const receiver = new THREE.Mesh(receiverGeometry, receiverMaterial);
  receiver.position.set(2, .5, -2); receiver.receiveShadow = shadows; scene.add(receiver);
  scene.add(new THREE.AmbientLight(0xffffff, .16));
  const light = lightKind === "point" ? new THREE.PointLight(0xffffff, 65, 30, 2) : new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(-2, 4, 5); light.castShadow = shadows;
  light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -.00001; light.shadow.normalBias = 0;
  light.shadow.camera.near = .1; light.shadow.camera.far = 30;
  if (lightKind !== "point") {
    light.target.position.set(2, .5, -1); scene.add(light.target);
    Object.assign(light.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
  }
  light.shadow.camera.updateProjectionMatrix(); scene.add(light);
  scene.updateMatrixWorld(true);
  if (mode === "loaded") skinned.skeleton.update();
  renderer.render(scene, camera);
  const pixels = new Uint8Array(384 * 384 * 4);
  gl.readPixels(0, 0, 384, 384, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const png = canvas.toDataURL("image/png");
  disposeAsset(asset); referenceGeometry?.dispose(); referenceMaterial?.dispose();
  receiverGeometry.dispose(); receiverMaterial.dispose(); light.shadow.dispose();
  return { pixels, png };
}
window.runGpuOracle = async () => {
  const results = [];
  for (const { name, angle, light, shadows } of [
    { name: "fifth-translation", angle: 0, light: "directional", shadows: false },
    { name: "rotated-normal", angle: Math.PI / 3, light: "directional", shadows: false },
    { name: "directional-shadow", angle: 0, light: "directional", shadows: true },
    { name: "point-shadow", angle: 0, light: "point", shadows: true },
  ]) {
    const actual = await render("loaded", angle, light, shadows);
    const expected = await render("reference", angle, light, shadows);
    const control = await render(shadows ? "reference" : "unmoved", angle, light, false);
    results.push({ name, comparison: difference(actual.pixels, expected.pixels),
      controlDifference: difference(expected.pixels, control.pixels), actual: actual.png, expected: expected.png });
  }
  renderer.dispose();
  return { rendererName, shaderErrors, results };
};
`;

const bundled = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent" });
const javascript = bundled.outputFiles[0].contents;
const server = createServer((request, response) => {
  if (request.url === "/entry.js") { response.setHeader("content-type", "text/javascript"); response.end(javascript); }
  else if (request.url === "/") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="en"><title>Eight influence GPU oracle</title><body><h1>Independent skinning image comparison</h1><canvas></canvas><script type="module" src="/entry.js"></script></body></html>'); }
  else { response.statusCode = 404; response.end(); }
});
await mkdir(output, { recursive: true });
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  const pageErrors = [], externalRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { const url = new URL(request.url()); if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") externalRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof window.runGpuOracle === "function");
  assert.equal(await page.locator("h1").textContent(), "Independent skinning image comparison");
  const report = await page.evaluate(() => window.runGpuOracle());
  for (const result of report.results) {
    for (const key of ["actual", "expected"]) {
      await writeFile(resolve(output, `${result.name}-${key}.png`), Buffer.from(result[key].split(",")[1], "base64"));
      delete result[key];
    }
  }
  report.pageErrors = pageErrors; report.externalRequests = externalRequests;
  await writeFile(resolve(output, "gpu-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(report.shaderErrors, []);
  for (const result of report.results) {
    assert.ok(result.controlDifference.changedPixels > 40, `${result.name}: ineffective image/shadow control`);
    assert.ok(result.comparison.meanAbsolute < .15 && result.comparison.changedPixels < 150,
      `${result.name}: loaded GPU output differs from independent geometric reference`);
  }
  console.log("PASS: position, rotated normals, directional and point shadows match geometric references; software GPU only.");
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
