// Actual Blender-exported calibration garment through the production loader.
// Optional local-artifact check; does not approve garment shape or collisions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

assert.equal(process.argv.length, 4, "Usage: check-morph-transport.mjs evidence-directory corrective|unregistered-control");
const directory = resolve(process.argv[2]), variant = process.argv[3];
assert.ok(["corrective", "unregistered-control"].includes(variant));
const reference = JSON.parse(readFileSync(resolve(directory, "reference.json"), "utf8"));
const bytes = readFileSync(resolve(directory, `${variant}.glb`));
const hash = value => createHash("sha256").update(value).digest("hex");
assert.equal(hash(bytes), reference.exports[variant]);
assert.equal(hash(readFileSync(reference.source)), reference.source_sha256);

const entry = String.raw`
import * as T from 'three';
import { loadPreviewAsset } from './apps/web/src/lib/scene/load-preview-asset.ts';
import { disposeAsset } from './apps/web/src/lib/scene/asset-resources.ts';
window.check = async reference => {
 const asset = await loadPreviewAsset(await (await fetch('/asset')).arrayBuffer());
 let boneCount=0;
 asset.scene.traverse(object=>{
  if(object.isBone)boneCount++;
  if(object.isMesh)for(const attribute of [...Object.values(object.geometry.attributes),...Object.values(object.geometry.morphAttributes).flat()]){
   if(!Array.from(attribute.array).every(Number.isFinite))throw Error('Nonfinite exported geometry');
  }
 });
 if(boneCount!==62||asset.animations.some(clip=>clip.tracks.some(track=>!Array.from(track.values).every(Number.isFinite)||!Array.from(track.times).every(Number.isFinite))))throw Error('Invalid skeleton or animation values');
 const expectedNames=Object.keys(reference.actions).sort();
 if(JSON.stringify(asset.animations.map(c=>c.name).sort())!==JSON.stringify(expectedNames)||expectedNames.length!==24)throw Error('Original 24 clips not retained');
 for(const clip of asset.animations){const [start,end]=reference.actions[clip.name];if(Math.abs(clip.duration-(end-start)/24)>1e-6)throw Error('Animation speed/duration changed');}
 const selected=[];
 for(const [name,source] of Object.entries(reference.rest)){
  const id=asset.parser.json.nodes.find(n=>n.name===name)?.mesh;
  if(id===undefined)throw Error('Missing robe '+name);
  asset.scene.traverse(mesh=>{
   if(!mesh.isSkinnedMesh||asset.parser.associations.get(mesh)?.meshes!==id)return;
   if(!mesh.geometry.getAttribute('bpSkinWeight1'))throw Error('Missing eight-influence path');
   if(mesh.morphTargetInfluences?.length!==1||mesh.geometry.morphAttributes.position?.length!==1)throw Error('Missing corrective morph target: '+name);
   const mapping=[],attribute=mesh.geometry.getAttribute('position');
   for(let i=0;i<attribute.count;i++){
    const point=new T.Vector3().fromBufferAttribute(attribute,i),candidates=[];
    for(let j=0;j<source.positions.length;j++)if(point.distanceTo(new T.Vector3(...source.positions[j]))<2e-6)candidates.push(j);
    if(!candidates.length)throw Error('No source vertex match');
    mapping.push(candidates);
   }
   selected.push({name,mesh,mapping});
  });
 }
 if(selected.length!==8)throw Error('Expected four robe panels with two materials each');
 const mixer=new T.AnimationMixer(asset.scene),canvas=document.createElement('canvas');
 document.body.append(canvas);
 const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true});
 renderer.setSize(384,384);renderer.setPixelRatio(1);renderer.setClearColor(0,0);
 const shaderErrors=[];renderer.debug.onShaderError=(gl,p,v,f)=>shaderErrors.push([gl.getProgramInfoLog(p),gl.getShaderInfoLog(v),gl.getShaderInfoLog(f)]);
 const scene=new T.Scene();scene.add(asset.scene);scene.add(new T.AmbientLight(0xffffff,1));
 asset.scene.traverse(o=>{if(o.isMesh)o.visible=selected.some(row=>row.mesh===o);if(o.isLight)o.visible=false;});
 const bakedScene=new T.Scene(),baked=[];
 for(const row of selected){
  const geometry=new T.BufferGeometry();geometry.setIndex(row.mesh.geometry.index.clone());
  geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(row.mapping.length*3),3));
  const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide}));
  bakedScene.add(mesh);baked.push(mesh);
 }
 const mask=()=>{const gl=renderer.getContext(),data=new Uint8Array(384*384*4);gl.readPixels(0,0,384,384,gl.RGBA,gl.UNSIGNED_BYTE,data);return Uint8Array.from({length:384*384},(_,i)=>data[i*4+3]>127?1:0);};
 const results=[];
 for(const sample of reference.samples){
  mixer.stopAllAction();const action=mixer.clipAction(asset.animations.find(c=>c.name===sample.action));
  action.reset().setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(sample.time);scene.updateMatrixWorld(true);
  let maxError=0,baselineMaxError=0,vertices=0;const bounds=new T.Box3();
  for(let part=0;part<selected.length;part++){
   const {name,mesh,mapping}=selected[part];mesh.skeleton.update();
   if(Math.abs(mesh.morphTargetInfluences[0]-sample.value)>1e-5)throw Error('Morph animation disagrees: '+sample.action+' '+mesh.morphTargetInfluences[0]+' != '+sample.value);
   const position=baked[part].geometry.getAttribute('position');
   for(let i=0;i<mapping.length;i++){
    const expected=new T.Vector3(...sample.positions[name][mapping[i][0]]);
    for(const candidate of mapping[i])if(expected.distanceTo(new T.Vector3(...sample.positions[name][candidate]))>2e-6)throw Error('Ambiguous source correspondence');
    const actual=mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld);
    if(!actual.toArray().every(Number.isFinite))throw Error('Nonfinite posed vertex');
    maxError=Math.max(maxError,actual.distanceTo(expected));vertices++;bounds.expandByPoint(expected);
    mesh.morphTargetInfluences[0]=0;
    const uncorrected=mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld);
    baselineMaxError=Math.max(baselineMaxError,uncorrected.distanceTo(new T.Vector3(...sample.baseline_positions[name][mapping[i][0]])));
    mesh.morphTargetInfluences[0]=sample.value;
    position.setXYZ(i,expected.x,expected.y,expected.z);
   }
   position.needsUpdate=true;baked[part].geometry.computeBoundingSphere();
  }
  const center=bounds.getCenter(new T.Vector3()),extent=bounds.getSize(new T.Vector3()).length()*.6;
  const views=[];
  for(const direction of [[0,0,1],[1,0,0],[.5,.25,-1]]){
   const camera=new T.OrthographicCamera(-extent,extent,extent,-extent,.01,30);
   camera.position.copy(center).addScaledVector(new T.Vector3(...direction).normalize(),5);camera.lookAt(center);camera.updateMatrixWorld(true);
   renderer.render(scene,camera);const actual=mask();renderer.render(bakedScene,camera);const expected=mask();
   let difference=0,coverage=0;for(let i=0;i<actual.length;i++){difference+=actual[i]!==expected[i]?1:0;coverage+=expected[i];}
   if(coverage<100)throw Error('Empty GPU witness');
   // Negative control: same bone pose with the morph disabled must visibly differ.
   let disabledDifference=0;
   if(sample.value===1){
    for(const {mesh} of selected)mesh.morphTargetInfluences[0]=0;
    renderer.render(scene,camera);const disabled=mask();
    for(let i=0;i<actual.length;i++)disabledDifference+=actual[i]!==disabled[i]?1:0;
    for(const {mesh} of selected)mesh.morphTargetInfluences[0]=sample.value;
   }
   views.push({direction,difference,coverage,disabledDifference});
  }
  if(sample.value===1&&!views.some(v=>v.disabledDifference>100))throw Error('GPU witness not sensitive to shape deformation');
  results.push({action:sample.action,frame:sample.frame,value:sample.value,maxError,baselineMaxError,vertices,views});
 }
 const gl=renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
 const device=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 mixer.stopAllAction();mixer.uncacheRoot(asset.scene);disposeAsset(asset);
 for(const mesh of baked){mesh.geometry.dispose();mesh.material.dispose();}renderer.dispose();
 return {results,shaderErrors,device,clips:asset.animations.length};
};
`;
const bundle = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,platform:"browser",format:"esm",logLevel:"silent"});
const server = createServer((req,res)=>{
  if(req.url==="/entry.js"){res.setHeader("content-type","text/javascript");res.end(bundle.outputFiles[0].contents);}
  else if(req.url==="/asset"){res.setHeader("content-type","model/gltf-binary");res.end(bytes);}
  else if(req.url==="/"){res.setHeader("content-type","text/html");res.end('<!doctype html><script type="module" src="/entry.js"></script>');}
  else{res.statusCode=404;res.end();}
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
let browser;
try{
  browser=await chromium.launch({headless:true,args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  const page=await browser.newPage(),errors=[],external=[];
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route("**/*",route=>{const url=new URL(route.request().url());if(["http:","https:"].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort();}return route.continue();});
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin);await page.waitForFunction(()=>typeof window.check==="function");
  const report=await page.evaluate(reference=>window.check(reference),reference);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(report.shaderErrors,[]);
  assert.equal(hash(readFileSync(reference.source)),reference.source_sha256);
  assert.equal(hash(readFileSync(resolve(directory,`${variant}.glb`))),reference.exports[variant]);
  console.log("MORPH_TRANSPORT "+JSON.stringify({source:reference.source_sha256,glb:hash(bytes),...report}));
  assert.ok(report.results.every(row=>row.maxError<.0001&&row.views.every(view=>view.difference/view.coverage<=.002)),
    "Morph transport acceptance failed: source/CPU 0.1mm or GPU silhouette 0.2% gate; inspect report, do not drop failing samples");
}finally{await browser?.close();await new Promise(done=>server.close(done));}
