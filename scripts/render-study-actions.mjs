// Local-only visual action audit, using the production complete-weight GLB loader.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readStudyLighting } from "./study-lighting.mjs";

const revision = process.argv[2] ?? "14";
assert.match(revision, /^[1-9][0-9]?$/);
const themes = process.argv[3] ? [process.argv[3]] : ["cyberpunk", "eastern"];
assert.ok(themes.every(theme => ["cyberpunk", "eastern"].includes(theme)));
const output = resolve(`.goal-loop/evidence/study-actions-v${revision}`);
const assets = new Map(), sourceReports = new Map();
for (const theme of themes) {
  const source = `.tools/asset-studies/dual-theme-v${revision}/${theme}.glb`, bytes = await readFile(source);
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.equal(document.animations.length, 24, "Audit requires every authored clip");
  const names = document.animations.map(clip => clip.name);
  assert.equal(new Set(names).size, 24, "Names must identify clips unambiguously");
  assets.set(theme, bytes);
  sourceReports.set(theme, { source, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, names,
    lighting: readStudyLighting(document.scenes[document.scene ?? 0].extras ?? {}, theme) });
}

const entry = String.raw`
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadPreviewAsset } from "./apps/web/src/lib/scene/load-preview-asset.ts";
import { disposeAsset } from "./apps/web/src/lib/scene/asset-resources.ts";
import { readStudyLighting } from "./scripts/study-lighting.mjs";
const width=500,height=390,canvas=document.createElement('canvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(width,height);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
const shaderErrors=[];
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>shaderErrors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)]);
const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
let asset,scene,mixer,skins,lighting,theme;
window.openTheme=async name=>{
 theme=name;asset=await loadPreviewAsset(await(await fetch('/asset/'+theme)).arrayBuffer());
 lighting=readStudyLighting(asset.scene.userData,theme);renderer.toneMappingExposure=lighting.exposure;
 scene=new THREE.Scene();scene.background=new THREE.Color(theme==='eastern'?'#D7DDD1':'#09141E');scene.environment=environment.texture;
 scene.environmentIntensity=lighting.environmentIntensity;scene.add(asset.scene);
 scene.add(new THREE.HemisphereLight(lighting.sky,lighting.ground,lighting.hemisphereIntensity));
 skins=[];const loadedLights=[];let meshCount=0;
 asset.scene.traverse(object=>{
  if(object.isMesh){meshCount++;object.castShadow=true;object.receiveShadow=true;}
  if(object.isSkinnedMesh)skins.push(object);
  if(object.isDirectionalLight){loadedLights.push({name:object.name,intensity:object.intensity});object.castShadow=true;object.shadow.mapSize.set(2048,2048);
   Object.assign(object.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.01,far:30});object.shadow.bias=-.00003;object.shadow.normalBias=.016;}
 });
 if(!skins.length||!skins.some(skin=>skin.geometry.getAttribute('bpSkinWeight1')))throw new Error('Expected production eight-influence skinning');
 mixer=new THREE.AnimationMixer(asset.scene);
 return {lighting,meshCount,skins:skins.length,extendedSkins:skins.filter(skin=>skin.geometry.getAttribute('weights_1')).length,
  patchedSkins:skins.filter(skin=>skin.geometry.getAttribute('bpSkinWeight1')).length,loadedLights,
  animations:asset.animations.map(clip=>({name:clip.name,duration:clip.duration,tracks:clip.tracks.length}))};
};
function sampleBounds(){
 scene.updateMatrixWorld(true);
 const bounds=new THREE.Box3(),vertex=new THREE.Vector3();let vertices=0;
 for(const skin of skins){
  skin.skeleton.update();
  for(let index=0;index<skin.geometry.getAttribute('position').count;index++){
   skin.getVertexPosition(index,vertex).applyMatrix4(skin.matrixWorld);
   if(!Number.isFinite(vertex.x)||!Number.isFinite(vertex.y)||!Number.isFinite(vertex.z))throw new Error('Nonfinite posed vertex: '+skin.name+' '+index);
   bounds.expandByPoint(vertex);vertices++;
  }
 }
 if(bounds.isEmpty())throw new Error('Empty character bounds');
 return {bounds,vertices};
}
window.renderAction=async index=>{
 const clip=asset.animations[index];if(!clip||!Number.isFinite(clip.duration)||clip.duration<=0)throw new Error('Invalid clip');
 mixer.stopAllAction();const action=mixer.clipAction(clip);action.reset();action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
 const times=[0,clip.duration/2,clip.duration],union=new THREE.Box3(),samples=[];
 // Reset before each requested time; final time is held, not loop-wrapped to zero.
 for(const time of times){action.reset().play();mixer.setTime(time);const sampled=sampleBounds();union.union(sampled.bounds);
  samples.push({time,actionTime:action.time,vertices:sampled.vertices,bounds:{min:sampled.bounds.min.toArray(),max:sampled.bounds.max.toArray()}});}
 const center=union.getCenter(new THREE.Vector3()),view=new THREE.Vector3(.28,.10,1).normalize();
 const right=new THREE.Vector3(0,1,0).cross(view).normalize(),up=view.clone().cross(right),camera=new THREE.PerspectiveCamera(28,width/height,.01,100);
 const tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanX=tanY*camera.aspect;let distance=0;
 for(const x of[union.min.x,union.max.x])for(const y of[union.min.y,union.max.y])for(const z of[union.min.z,union.max.z]){
  const p=new THREE.Vector3(x,y,z).sub(center);distance=Math.max(distance,p.dot(view)+Math.max(Math.abs(p.dot(right))/tanX,Math.abs(p.dot(up))/tanY));}
 camera.position.copy(center).addScaledVector(view,distance*1.12);camera.lookAt(center);camera.updateMatrixWorld(true);
 const frames=[];
 for(const time of times){action.reset().play();mixer.setTime(time);scene.updateMatrixWorld(true);renderer.render(scene,camera);
  frames.push({time,actionTime:action.time,png:canvas.toDataURL('image/png'),drawCalls:renderer.info.render.calls,trianglesIncludingShadows:renderer.info.render.triangles});}
 const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 return {name:clip.name,duration:clip.duration,tracks:clip.tracks.length,samples,frames,camera:{position:camera.position.toArray(),target:center.toArray(),fov:camera.fov},
  shaderErrors:[...shaderErrors],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
};
window.showAtlas=async ({theme,clips,page})=>{
 document.body.dataset.theme=theme;document.querySelector('h1').textContent=theme+' / actual action audit / page '+page;
 document.querySelector('#atlas').replaceChildren();
 for(const clip of clips)for(const frame of clip.frames){
  const tile=document.createElement('figure'),label=document.createElement('figcaption'),image=document.createElement('img');
  label.textContent=clip.name+' | '+frame.time.toFixed(3)+' / '+clip.duration.toFixed(3)+' s'+(frame.time===clip.duration?' · final hold':'');
  image.src=frame.png;image.width=width;image.height=height;image.alt=label.textContent;tile.append(label,image);document.querySelector('#atlas').append(tile);await image.decode();
 }
};
window.closeTheme=()=>{mixer.stopAllAction();mixer.uncacheRoot(asset.scene);asset.scene.traverse(object=>{if(object.isLight)object.shadow?.dispose();});disposeAsset(asset);scene.clear();};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent" });
const server = createServer((request, response) => {
  const asset = assets.get(request.url?.replace("/asset/", ""));
  if (request.url === "/entry.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
  else if (asset) { response.setHeader("content-type", "model/gltf-binary"); response.end(asset); }
  else if (request.url === "/") {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html lang="en"><title>Local animation evidence</title><style>
      *{box-sizing:border-box}body{margin:0;background:#07131c;color:#eef5f7;font:15px system-ui;width:1500px}
      h1{margin:0;padding:12px 18px;font-size:20px}body[data-theme=eastern]{background:#e9e7dc;color:#24362f}
      #atlas{display:grid;grid-template-columns:repeat(3,500px)}figure{margin:0;border:1px solid #668080}
      figcaption{height:42px;padding:10px 12px;font-weight:600;white-space:nowrap}img{display:block;width:498px;height:390px}
      </style><h1>Local action study</h1><main id="atlas"></main><script type="module" src="/entry.js"></script></html>`);
  } else { response.statusCode = 404; response.end(); }
});
await mkdir(output, { recursive: true });
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 2800 } }), errors = [], external = [];
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { external.push(url.origin); return route.abort("blockedbyclient"); }
    return route.continue();
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.waitForFunction(() => typeof window.openTheme === "function");
  for (const theme of themes) {
    const metadata = await page.evaluate(name => window.openTheme(name), theme), source = sourceReports.get(theme);
    assert.deepEqual(metadata.animations.map(clip => clip.name), source.names);
    assert.deepEqual(metadata.lighting, source.lighting);
    assert.ok(metadata.extendedSkins > 0 && metadata.patchedSkins === metadata.skins);
    const clips = [], atlases = [];
    for (let offset = 0; offset < metadata.animations.length; offset += 6) {
      const batch = [];
      for (let index = offset; index < Math.min(offset + 6, metadata.animations.length); index++) {
        const clip = await page.evaluate(index => window.renderAction(index), index);
        assert.deepEqual(clip.shaderErrors, []); assert.equal(clip.frames.length, 3);
        assert.equal(clip.frames.at(-1).actionTime, clip.duration, "Final frame must hold the clip end without wrapping");
        assert.ok(clip.samples.every(sample => sample.vertices > 0));
        assert.ok(clip.frames.every(frame => frame.drawCalls > 0));
        batch.push(clip); console.log(`${theme}: ${clip.name} (${clip.duration.toFixed(3)}s), 3 actual poses`);
      }
      const number = offset / 6 + 1;
      await page.evaluate(input => window.showAtlas(input), { theme, clips: batch, page: number });
      const filename = `${theme}-actions-${number}.png`;
      await page.screenshot({ path: resolve(output, filename), fullPage: true }); atlases.push(filename);
      clips.push(...batch.map(clip => ({ ...clip, frames: clip.frames.map(({ png, ...frame }) => frame) })));
    }
    await writeFile(resolve(output, `${theme}-report.json`), JSON.stringify({ revision, ...source, ...metadata, clips, atlases,
      sampling: "Three poses per named clip: start, midpoint, exact final hold. Every skinned vertex checked at these poses only. Manual visible collision review is separate; finite coordinates do not prove collision freedom.",
      framing: "Per-clip fixed front-three-quarter camera fitted to union of three posed full-character bounds. All exported environment, costume and accessories retained." }, null, 2));
    await page.evaluate(() => window.closeTheme());
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(output, "runtime-report.json"), JSON.stringify({ revision, themes, pageErrors: errors, externalRequests: external, screenshotsPerTheme: 4, renderedPosesPerTheme: 72 }, null, 2));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
