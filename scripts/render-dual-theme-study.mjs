// Optional real WebGL art evidence from local, self-contained study exports.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readStudyLighting } from "./study-lighting.mjs";

const revision = process.argv[2] ?? "1";
assert.match(revision, /^[1-9][0-9]?$/);
const themes = process.argv[3] ? [process.argv[3]] : ["cyberpunk", "eastern"];
assert.ok(themes.every(theme => ["cyberpunk", "eastern"].includes(theme)));
const output = resolve(`.goal-loop/evidence/dual-theme-v${revision}`);
const assets = new Map(await Promise.all(themes.map(async theme => [theme, await readFile(`.tools/asset-studies/dual-theme-v${revision}/${theme}.glb`)])));
const exportReports = new Map();
for (const [theme, bytes] of assets) {
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binary = bytes.subarray(28 + jsonLength);
  const leaves = document.materials.find(material => material.name === "BirchTree_Leaves");
  if (Number(revision) >= 12 && theme === "cyberpunk") {
    assert.equal(leaves, undefined, "The cyber alcove intentionally excludes the garden canopy");
    assert.equal(document.materials.find(material => material.name === "BirchTree_Bark"), undefined);
  } else {
    assert.deepEqual(leaves?.pbrMetallicRoughness?.baseColorFactor?.map(value => Math.round(value * 100)), Number(revision) >= 10 ? [10, 28, 80, 100] : [36, 62, 72, 100], `${theme}: authored canopy tint must survive export`);
    if (Number(revision) >= 11) {
      const bark = document.materials.find(material => material.name === "BirchTree_Bark");
      assert.deepEqual(bark?.pbrMetallicRoughness?.baseColorFactor?.map(value => Math.round(value * 100)), [72, 68, 58, 100], `${theme}: bark must retain its separate neutral tint`);
    }
  }
  if (Number(revision) >= 12) {
    const extras = document.scenes[document.scene ?? 0].extras;
    assert.ok(extras?.blueprint_lighting, "New studies must export authored lighting");
    readStudyLighting(extras, theme);
  }
  let finiteFloatValues = 0;
  for (const accessor of document.accessors.filter(accessor => accessor.componentType === 5126)) {
    const view = document.bufferViews[accessor.bufferView];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
    assert.ok(components && !accessor.sparse, "Study exporter must produce dense supported float accessors");
    for (let row = 0; row < accessor.count; row++) for (let column = 0; column < components; column++) {
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + row * (view.byteStride ?? components * 4) + column * 4;
      assert.ok(Number.isFinite(binary.readFloatLE(offset)), `${theme}: non-finite exported value`);
      finiteFloatValues++;
    }
  }
  assert.equal(document.skins.length, 1); assert.equal(document.skins[0].joints.length, 62);
  exportReports.set(theme, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), finiteFloatValues,
    assetTriangles: document.meshes.flatMap(mesh => mesh.primitives).reduce((sum, primitive) => sum + document.accessors[primitive.indices].count / 3, 0) });
}
const entry = String.raw`
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadPreviewAsset } from "./apps/web/src/lib/scene/load-preview-asset.ts";
import { disposeAsset } from "./apps/web/src/lib/scene/asset-resources.ts";
import { readStudyLighting } from "./scripts/study-lighting.mjs";
const canvas = document.querySelector("canvas");
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true});
renderer.setSize(1440,1000); renderer.setPixelRatio(1); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
const shaderErrors=[];renderer.debug.onShaderError=(gl,program,vertex,fragment)=>shaderErrors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)]);
window.renderTheme = async theme => {
 const asset=await loadPreviewAsset(await (await fetch('/asset/'+theme)).arrayBuffer());
 const lighting=readStudyLighting(asset.scene.userData,theme);renderer.toneMappingExposure=lighting.exposure;
 const scene=new THREE.Scene();scene.background=new THREE.Color(theme==='eastern'?'#D7DDD1':'#09141E');scene.environment=environment.texture;scene.environmentIntensity=lighting.environmentIntensity;scene.add(asset.scene);
 const ambient=new THREE.HemisphereLight(lighting.sky,lighting.ground,lighting.hemisphereIntensity);scene.add(ambient);
 let skins=0,extendedSkins=0,meshCount=0; const loadedLights=[];
 asset.scene.traverse(object=>{
  if(object.isMesh){meshCount++;object.castShadow=true;object.receiveShadow=true;}
  if(object.isSkinnedMesh){skins++;if(object.geometry.getAttribute('weights_1'))extendedSkins++;}
  if(object.isDirectionalLight){loadedLights.push({name:object.name,intensity:object.intensity});object.castShadow=true;object.shadow.mapSize.set(2048,2048);Object.assign(object.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.01,far:30});object.shadow.bias=-.00003;object.shadow.normalBias=.016;}
 });
 const camera=asset.cameras[0];if(!camera)throw new Error('Missing composed camera');camera.aspect=1440/1000;camera.updateProjectionMatrix();
 const idle=asset.animations.find(clip=>clip.name==='Idle_Neutral');if(!idle)throw new Error('Missing real idle clip');
 const mixer=new THREE.AnimationMixer(asset.scene);mixer.clipAction(idle).play();mixer.setTime(.15);scene.updateMatrixWorld(true);renderer.render(scene,camera);
 const wide=canvas.toDataURL('image/png');const sceneCalls=renderer.info.render.calls;
 const center=new THREE.Vector3(theme==='eastern'?.35:.28,1.10,theme==='eastern'?.6:.5);
 camera.position.copy(center).add(new THREE.Vector3(1.7,.45,3.35));camera.lookAt(center);camera.updateMatrixWorld(true);renderer.render(scene,camera);
 const portrait=canvas.toDataURL('image/png');mixer.setTime(.8);scene.updateMatrixWorld(true);renderer.render(scene,camera);const idleLater=canvas.toDataURL('image/png');
 const context=renderer.getContext(),debug=context.getExtension('WEBGL_debug_renderer_info');
 const result={wide,portrait,idleLater,lighting,meshCount,skins,extendedSkins,sceneCalls,renderedTrianglesIncludingShadows:renderer.info.render.triangles,animations:asset.animations.length,loadedLights,shaderErrors:[...shaderErrors],renderer:debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER)};
 mixer.stopAllAction();mixer.uncacheRoot(asset.scene);asset.scene.traverse(object=>{if(object.isLight)object.shadow?.dispose();});disposeAsset(asset);scene.clear();return result;
};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent" });
const server = createServer((request, response) => {
  const asset = assets.get(request.url?.replace("/asset/", ""));
  if (request.url === "/entry.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
  else if (asset) { response.setHeader("content-type", "model/gltf-binary"); response.end(asset); }
  else if (request.url === "/") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="en"><title>Blueprint internal theme study</title><h1>Local dual-theme art study</h1><canvas></canvas><script type="module" src="/entry.js"></script></html>'); }
  else { response.statusCode = 404; response.end(); }
});
await mkdir(output, { recursive: true });
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  const errors = [], external = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { const url = new URL(request.url()); if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") external.push(url.origin); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator("h1").textContent(), "Local dual-theme art study");
  await page.waitForFunction(() => typeof window.renderTheme === "function");
  for (const theme of themes) {
    const report = await page.evaluate(themeName => window.renderTheme(themeName), theme);
    const bytes = assets.get(theme);
    const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.deepEqual(report.lighting, readStudyLighting(document.scenes[document.scene ?? 0].extras ?? {}, theme), "GLTFLoader must preserve the exported lighting");
    Object.assign(report, exportReports.get(theme));
    assert.notEqual(report.portrait, report.idleLater, "Actual idle must visibly change the character");
    for (const key of ["wide", "portrait", "idleLater"]) { await writeFile(resolve(output, `${theme}-${key}.png`), Buffer.from(report[key].split(",")[1], "base64")); delete report[key]; }
    assert.ok(report.skins >= 10 && report.extendedSkins > 0 && report.sceneCalls > 0);assert.equal(report.animations,24);assert.deepEqual(report.shaderErrors,[]);
    assert.ok(report.loadedLights.length === 2 && report.loadedLights.every(light => light.intensity > 0 && light.intensity <= 5), "Study lighting must use the authored unitless exposure convention, not the x683 physical conversion");
    await writeFile(resolve(output, `${theme}-report.json`), JSON.stringify(report,null,2));console.log(theme,report);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
