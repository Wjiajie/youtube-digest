import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

assert.ok(process.argv.length <= 3, "Use one optional study revision");
const revision = process.argv[2] ?? "16";
assert.match(revision, /^[1-9][0-9]?$/);
const base = `.tools/asset-studies/dual-theme-v${revision}/eastern`;
const sourceHash = createHash("sha256").update(readFileSync(`${base}.blend`)).digest("hex");
const sourceRun = spawnSync(".tools/blender-4.5.13/Blender.app/Contents/MacOS/Blender",
  ["--background", "--factory-startup", "--disable-autoexec", "--offline-mode", `${base}.blend`,
    "--python-exit-code", "1", "--python", "scripts/study-source-poses.py"],
  { encoding: "utf8", timeout: 30_000, maxBuffer: 10_000_000 });
assert.ifError(sourceRun.error);
assert.equal(sourceRun.status, 0, sourceRun.stderr);
const line = sourceRun.stdout.split("\n").find(line => line.startsWith("SOURCE_POSE_REFERENCE "));
assert.ok(line, sourceRun.stdout);
const reference = JSON.parse(line.slice("SOURCE_POSE_REFERENCE ".length));
assert.equal(reference.source_sha256, sourceHash);
assert.equal(reference.source_sha256_after, sourceHash);
const bytes = readFileSync(`${base}.glb`);
const glbHash = createHash("sha256").update(bytes).digest("hex");

const entry = String.raw`
import { AnimationMixer, LoopOnce, Vector3 } from "three";
import { loadPreviewAsset } from "./apps/web/src/lib/scene/load-preview-asset.ts";
import { disposeAsset } from "./apps/web/src/lib/scene/asset-resources.ts";
window.compare = async reference => {
 const asset = await loadPreviewAsset(await(await fetch('/asset')).arrayBuffer());
 const selected=[],weightLosses=[];
 for(const [name,source] of Object.entries(reference.targets)) {
  const meshID=asset.parser.json.nodes.find(node=>node.name===name)?.mesh;
  if(meshID===undefined)throw Error('Missing exported node '+name);
  asset.scene.traverse(mesh=>{
   if(!mesh.isSkinnedMesh||asset.parser.associations.get(mesh)?.meshes!==meshID)return;
   if(!mesh.geometry.getAttribute('bpSkinWeight1'))throw Error('Missing complete-weight loader path');
   const positions=mesh.geometry.getAttribute('position'), mapping=[];
   for(let vertex=0;vertex<positions.count;vertex++){
    const point=new Vector3().fromBufferAttribute(positions,vertex), candidates=[];
    const weights={};
    for(const [joints,values] of [['skinIndex','skinWeight'],['bpSkinIndex1','bpSkinWeight1']]){
     for(let component=0;component<4;component++){
      const weight=mesh.geometry.getAttribute(values).getComponent(vertex,component);
      if(!weight)continue;
      const bone=mesh.skeleton.bones[mesh.geometry.getAttribute(joints).getComponent(vertex,component)];
      const id=asset.parser.associations.get(bone)?.nodes;
      if(id===undefined)throw Error('Missing bone association');
      const key=asset.parser.json.nodes[id].name; weights[key]=(weights[key]??0)+weight;
     }
    }
    for(let index=0;index<source.rest.length;index++){
     if(point.distanceTo(new Vector3(...source.rest[index]))>2e-6)continue;
     const original=source.raw_weights[index];
     // Pinned Blender exporter primitive_extract.py:1539 drops <=0.0001
     // before renormalization, even with export_all_influences. Record loss;
     // this correspondence does NOT claim complete source weight preservation.
     const retained=Object.entries(original).filter(([,value])=>value>.0001),sum=retained.reduce((sum,[,value])=>sum+value,0);
     const expected=Object.fromEntries(retained.map(([key,value])=>[key,value/sum]));
     const names=new Set([...Object.keys(expected),...Object.keys(weights)]);
     if([...names].every(key=>Math.abs((expected[key]??0)-(weights[key]??0))<2e-6)){
      candidates.push(index);
      const dropped=Object.fromEntries(Object.entries(original).filter(([,value])=>value<=.0001));
      if(Object.keys(dropped).length)weightLosses.push({target:name,exportVertex:vertex,sourceVertex:index,dropped});
     }
    }
    if(!candidates.length){
     const nearest=source.rest.map((p,index)=>({index,distance:point.distanceTo(new Vector3(...p))})).sort((a,b)=>a.distance-b.distance).slice(0,2);
     throw Error('No rest-position AND exporter-policy weight match: '+JSON.stringify({name,vertex,point:point.toArray(),weights,nearest:nearest.map(item=>({...item,expected:source.weights[item.index],rest:source.rest[item.index]}))}));
    }
    mapping.push(candidates);
   }
   selected.push({name,mesh,mapping});
  });
 }
 if(selected.length!==3)throw Error('Expected two body primitives plus sash');
 const mixer=new AnimationMixer(asset.scene), results=[];
 for(const pose of reference.poses){
  const clip=asset.animations.find(clip=>clip.name===pose.action);
  if(!clip)throw Error('Missing clip '+pose.action);
  mixer.stopAllAction();const action=mixer.clipAction(clip);action.reset();action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
  mixer.setTime(pose.time);asset.scene.updateMatrixWorld(true);
  const rows=[];
  for(const {name,mesh,mapping} of selected){
   mesh.skeleton.update();let maxError=0,worst=null;
   for(let index=0;index<mapping.length;index++){
    const candidates=mapping[index], expected=pose.targets[name][candidates[0]];
    for(const candidate of candidates)if(new Vector3(...expected).distanceTo(new Vector3(...pose.targets[name][candidate]))>2e-6)throw Error('Ambiguous rest correspondence');
    const actual=mesh.getVertexPosition(index,new Vector3()).applyMatrix4(mesh.matrixWorld);
    if(!actual.toArray().every(Number.isFinite))throw Error('Nonfinite runtime vertex');
    const error=actual.distanceTo(new Vector3(...expected));
    if(error>maxError){maxError=error;worst={exportVertex:index,sourceVertices:candidates,actual:actual.toArray(),expected};}
   }
   rows.push({target:name,primitive:mesh.name,vertices:mapping.length,maxError,worst});
  }
  results.push({action:pose.action,frame:pose.frame,time:pose.time,actionTime:action.time,rows});
 }
 mixer.stopAllAction();mixer.uncacheRoot(asset.scene);disposeAsset(asset);return {results,weightLosses};
};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "esm", logLevel: "silent" });
const server = createServer((req, res) => {
  if (req.url === "/entry.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
  else if (req.url === "/asset") { res.setHeader("content-type", "model/gltf-binary"); res.end(bytes); }
  else if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><script type="module" src="/entry.js"></script>'); }
  else { res.statusCode = 404; res.end(); }
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),errors=[],external=[];
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.href);return route.abort();}
    return route.continue();
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.waitForFunction(()=>typeof window.compare==='function');
  const {results,weightLosses}=await page.evaluate(reference=>window.compare(reference),reference);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log("STUDY_POSE_PARITY "+JSON.stringify({source:reference.source_sha256,glb:glbHash,fps:reference.fps,weightLosses,
    results:results.map(pose=>({...pose,rows:pose.rows.map(({worst,...row})=>row)}))}));
  assert.equal(createHash("sha256").update(readFileSync(`${base}.blend`)).digest("hex"), sourceHash);
  assert.ok(readFileSync(`${base}.glb`).equals(bytes), "Exported asset must remain unchanged");
  assert.ok(results.every(pose=>pose.rows.every(row=>row.maxError<.0001)), 'Posed source and actual production CPU loader differ by at least 0.1mm');
} finally { await browser?.close();await new Promise(done=>server.close(done)); }
