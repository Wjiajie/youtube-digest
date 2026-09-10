// Internal, fictional local composition evidence. Not imported by production.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";

const revision = process.argv[2] ?? "11";
assert.match(revision, /^[1-9][0-9]?$/);
const output = resolve(`.goal-loop/evidence/dual-theme-panel-v${revision}`);
const themes = ["cyberpunk", "eastern"];
const assets = new Map(await Promise.all(themes.map(async theme => [theme, await readFile(`.tools/asset-studies/dual-theme-v${revision}/${theme}.glb`)])));
const entry = String.raw`
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ThemeSurface } from "@blueprint/ui/theme";
import { HomeDashboard } from "./apps/web/src/app/home-dashboard.tsx";
import { loadPreviewAsset } from "./apps/web/src/lib/scene/load-preview-asset.ts";
import { disposeAsset } from "./apps/web/src/lib/scene/asset-resources.ts";
import "./apps/web/src/app/globals.css";

const titles = ["建立自己的摄影语言", "把日常观察写成有观点、有依据、能让读者理解取舍的长篇摄影作品集与创作复盘"];
const goals = titles.map((title, index) => {
 const node = {id:'study-node-'+index,title:index?'完成一组照片的取舍说明与自我复盘':'用不同光线拍摄同一场景',type:'practice',position:0,dependencyIds:[],resources:[],estimatedMinutes:45,completionCriteria:'保留六张照片，写出两处选择与一项下次要尝试的调整。'};
 const stage = {id:'study-stage-'+index,title:'观察与表达',position:0,nodes:[node]};
 const next = {node,stageId:stage.id,stageTitle:stage.title,status:null,completion:'open',blockedBy:[]};
 return {goal:{id:'study-goal-'+index,title,position:index,stages:[stage]},nodes:[next],next,confirmedCheckpoints:0,needsReviewCount:0,awaitingPlan:false,allSelfConfirmed:false};
});
window.sceneDisposals = 0;
function AssetScene({theme}) {
 const canvasRef = useRef(null);
 const [status,setStatus] = useState('loading');
 useEffect(() => {
  let stopped=false, asset, renderer, environment, mixer, observer, scene;
  const shaderErrors=[];
  const release=()=>{
   observer?.disconnect();mixer?.stopAllAction();if(asset)mixer?.uncacheRoot(asset.scene);
   asset?.scene.traverse(object=>{if(object.isLight)object.shadow?.dispose();});
   if(asset){disposeAsset(asset);asset=undefined;}
   scene?.clear();environment?.dispose();renderer?.dispose();renderer?.forceContextLoss();
  };
  (async()=>{
   const response=await fetch('/asset/'+theme);if(!response.ok)throw new Error('Local study asset unavailable');
   const loaded=await loadPreviewAsset(await response.arrayBuffer());
   if(stopped){disposeAsset(loaded);return;}asset=loaded;
   const canvas=canvasRef.current;
   renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
   renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
   renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
   renderer.debug.onShaderError=(gl,program,vertex,fragment)=>shaderErrors.push([gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)]);
   const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
   scene=new THREE.Scene();scene.environment=environment.texture;scene.environmentIntensity=theme==='eastern'?.35:.6;scene.add(asset.scene);
   scene.add(new THREE.HemisphereLight(theme==='eastern'?'#E8EED8':'#AECBD4',theme==='eastern'?'#7A8980':'#283A48',theme==='eastern'?1.1:.8));
   const skins=[];asset.scene.traverse(object=>{
    if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
    if(object.isSkinnedMesh)skins.push(object);
    if(object.isDirectionalLight){object.castShadow=true;object.shadow.mapSize.set(2048,2048);Object.assign(object.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.01,far:30});object.shadow.bias=-.00003;object.shadow.normalBias=.016;}
   });
   const idle=asset.animations.find(clip=>clip.name==='Idle_Neutral');if(!idle)throw new Error('Missing authored neutral clip');
   mixer=new THREE.AnimationMixer(asset.scene);mixer.clipAction(idle).play();mixer.setTime(.15);scene.updateMatrixWorld(true);
   const bounds=new THREE.Box3();for(const skin of skins)bounds.union(new THREE.Box3().setFromObject(skin,true));
   if(bounds.isEmpty())throw new Error('Missing character bounds');
   const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
   const camera=new THREE.PerspectiveCamera(28,1,.01,100);
   const render=()=>{
    if(stopped)return;
    const width=canvas.clientWidth,height=canvas.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/height;
    const distance=Math.max(size.y,size.x/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))/.82;
    camera.position.copy(center).add(new THREE.Vector3(.28,.10,1).normalize().multiplyScalar(distance));camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    renderer.render(scene,camera);
    const projected=[];for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])projected.push(new THREE.Vector3(x,y,z).project(camera));
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    window.sceneReport={theme,width,height,skins:skins.length,extendedSkins:skins.filter(skin=>skin.geometry.getAttribute('weights_1')).length,animations:asset.animations.length,drawCalls:renderer.info.render.calls,avatarHeightFraction:(Math.max(...projected.map(p=>p.y))-Math.min(...projected.map(p=>p.y)))/2,shaderErrors:[...shaderErrors],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
   };
   render();observer=new ResizeObserver(render);observer.observe(canvas);setStatus('ready');
  })().catch(error=>{if(!stopped){window.studyError=String(error);setStatus('failed');}release();});
  return()=>{stopped=true;release();window.sceneDisposals++;};
 },[theme]);
 return <figure className="panel-study-scene" data-scene-status={status}>
  <div className="home-identity-coordinate">PERSONAL ATLAS<br/>LOCAL ART STUDY / NOT RELEASED</div>
  <canvas ref={canvasRef} role="img" aria-label={theme==='eastern'?'山水主题人物与环境研究':'赛博主题人物与环境研究'}/>
  <figcaption className="home-identity-caption"><span className="home-identity-seal" aria-hidden="true">行</span><div><strong>沿着自己的方向</strong><p>本地美术研究 · 非正式形象</p><small>虚构目标只用于构图检查，不代表你的路径与成果。</small></div></figcaption>
 </figure>;
}
function PanelStudy(){
 const [config,setConfig]=useState(()=>({theme:new URLSearchParams(location.search).get('theme')??'cyberpunk',fallback:false}));
 window.showPanel=setConfig;
 return <ThemeSurface theme={config.theme}><main className="shell"><header className="panel-study-header"><span className="brand">Blueprint / Internal study</span><p>内部构图研究 · 全部目标为虚构示例 · 不连接账号或数据库</p></header>
 <HomeDashboard goals={goals} evidence={{ok:true,value:[]}} identityScene={config.fallback?null:<AssetScene theme={config.theme}/>}/></main></ThemeSurface>;
}
createRoot(document.getElementById('root'),{onUncaughtError:error=>{window.studyError=String(error);}}).render(<PanelStudy/>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false,
  outfile: "panel.js", platform: "browser", format: "esm", jsx: "automatic", conditions: ["style"], logLevel: "silent" });
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).contents;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text + `
.panel-study-header{border-bottom:1px solid var(--bp-line);padding-bottom:18px}.panel-study-header p{font-size:12px;line-height:1.8;color:var(--bp-muted)}
.panel-study-scene{margin:0;display:flex;flex-direction:column;min-width:0;flex:1}.panel-study-scene canvas{display:block;width:100%;height:460px;min-width:0}.panel-study-scene .home-identity-caption{padding-top:20px}
@media(max-width:560px){.panel-study-scene canvas{height:390px}}
`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const asset = assets.get(pathname.replace("/asset/", ""));
  if (pathname === "/entry.js") { response.setHeader("content-type", "text/javascript"); response.end(js); }
  else if (pathname === "/styles.css") { response.setHeader("content-type", "text/css"); response.end(css); }
  else if (asset) { response.setHeader("content-type", "model/gltf-binary"); response.end(asset); }
  else if (pathname === "/") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blueprint local fictional panel study</title><link rel="stylesheet" href="/styles.css"><div id="root"></div><script type="module" src="/entry.js"></script></html>'); }
  else { response.statusCode = 404; response.end(); }
});
await mkdir(output, { recursive: true });
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const theme of themes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], external = [], reports = [], assetRequests = [];
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { external.push(url.href); return route.abort(); }
      return route.continue();
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/asset/")) assetRequests.push(new URL(request.url()).pathname); });
    await page.goto(`${origin}/?theme=${theme}`);
    await page.waitForFunction(() => typeof window.showPanel === "function");
    await page.evaluate(theme => window.showPanel({ theme, fallback: false }), theme);
    await page.waitForFunction(theme => window.studyError || window.sceneReport?.theme === theme && document.querySelector('[data-scene-status="ready"]'), theme);
    assert.equal(await page.evaluate(() => window.studyError), undefined);
    const buttons = page.getByRole("button", { name: /^关注目标：/ });
    assert.equal(await buttons.count(), 2);
    await buttons.nth(1).focus(); await page.keyboard.press("Enter");
    assert.equal(await buttons.nth(1).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('.home-current-focus a').getAttribute("href"), "/paths/study-goal-1?node=study-node-1");
    for (const fallback of [false, true]) {
      if (fallback) {
        assert.equal(await page.evaluate(() => window.sceneDisposals), 0);
        await page.evaluate(theme => window.showPanel({ theme, fallback: true }), theme);
        await page.getByRole("region", { name: "个人身份静态回退", exact: true }).waitFor();
        assert.equal(await page.locator("canvas").count(), 0);
        assert.equal(await page.evaluate(() => window.sceneDisposals), 1);
      }
      for (const width of [1440, 960, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        // Chromium's captureBeyondViewport path can resnap horizontal rails
        // during fullPage capture. Lay out the full height explicitly first,
        // then capture the ordinary viewport without mutating product CSS.
        const captureHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width, height: captureHeight });
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        await buttons.nth(1).evaluate(element => element.scrollIntoView({ block: "nearest", inline: "start", behavior: "instant" }));
        await page.waitForFunction(() => {
          const rail=document.querySelector('.home-goal-rail').getBoundingClientRect();
          const selected=document.querySelector('.home-goal-module[aria-pressed="true"]').getBoundingClientRect();
          return selected.left>=rail.left-1&&selected.right<=rail.right+1;
        });
        assert.equal(await page.locator("[data-bp-theme]").getAttribute("data-bp-theme"), theme);
        assert.equal(await buttons.nth(1).getAttribute("aria-pressed"), "true");
        const layout = await page.evaluate(() => {
          const selectors=['.home-goal-rail','.home-identity','.home-current-focus'];
          const boxes=selectors.map(selector=>{const b=document.querySelector(selector).getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};});
          return {overflow:document.documentElement.scrollWidth>innerWidth,boxes};
        });
        assert.equal(layout.overflow, false, `${theme} ${width}: page must not overflow`);
        for(let i=0;i<layout.boxes.length;i++)for(let j=i+1;j<layout.boxes.length;j++){
          const a=layout.boxes[i],b=layout.boxes[j];
          assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1, "Goal, identity and focus panels must not overlap");
        }
        if (!fallback) {
          const report=await page.evaluate(()=>window.sceneReport);
          assert.ok(report.skins>=10&&report.extendedSkins>0&&report.drawCalls>0);
          assert.equal(report.animations,24);assert.deepEqual(report.shaderErrors,[]);
          assert.ok(report.avatarHeightFraction>=.6&&report.avatarHeightFraction<=1.05,"Avatar must be a meaningful, unclipped panel subject");
          reports.push({viewport:width,captureHeight,...report});
        }
        await page.screenshot({path:resolve(output,`${theme}-${fallback?'fallback':'scene'}-${width}.png`),fullPage:false});
        assert.ok(await page.evaluate(() => {
          const rail=document.querySelector('.home-goal-rail').getBoundingClientRect();
          const selected=document.querySelector('.home-goal-module[aria-pressed="true"]').getBoundingClientRect();
          return selected.left>=rail.left-1&&selected.right<=rail.right+1;
        }), "Selected goal must still be fully visible after screenshot capture");
      }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.deepEqual(assetRequests,[`/asset/${theme}`],"Goal selection, resizing and fallback must not trigger extra asset loads");
    const bytes=assets.get(theme);
    await writeFile(resolve(output,`${theme}-report.json`),JSON.stringify({revision,theme,sha256:createHash('sha256').update(bytes).digest('hex'),reports,goalSelection:'keyboard Enter, long title focus retained through fallback',assetRequests,sceneDisposals:1,externalRequests:external,pageErrors:errors},null,2));
    console.log(theme,JSON.stringify(reports));
    await page.close();
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
