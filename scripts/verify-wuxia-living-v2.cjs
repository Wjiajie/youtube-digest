const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sharp = require('sharp');
const rigConfig = require('../apps/web/src/lib/scene/living-portrait-rig-config.json');
const base = process.env.WUXIA_BASE_URL || 'http://127.0.0.1:3100';
const out = path.resolve('.goal-loop/evidence/wuxia-living-v2-2026-10-17', process.argv.includes('--inspect') ? 'inspection' : process.argv.includes('--production') ? 'production' : 'final');
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error' && !e.location().url.endsWith('/favicon.ico')) errors.push(e.text()); });
    page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== base) external.push(r.url()); });
    await page.goto(base + '/scenes/wuxia', { waitUntil: 'networkidle' });
    const root = page.locator('.living-portrait'), stage = page.getByTestId('living-stage'), canvas = stage.locator('canvas');
    await page.locator('.living-portrait[data-state="ready"]').waitFor({ timeout: 45000 });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(out, 'desktop-page.png'), fullPage: true });
    await stage.screenshot({ path: path.join(out, 'scene.png') });
    const gpu = await canvas.evaluate(c => { const gl = c.getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info'); return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable'; });
    const state = await canvas.evaluate(c => ({ time: c.dataset.sceneTime, frames: c.dataset.sceneFrames, width: c.width, height: c.height }));
    if (process.argv.includes('--inspect')) {
      const result = { gpu, state, errors, external };
      await fs.writeFile(path.join(out, 'inspection.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result)); return;
    }
    const checks = [], failures = [];
    const time = () => canvas.getAttribute('data-scene-time').then(Number);
    const pause = async () => { await page.getByRole('button', { name: '暂停动效', exact: true }).click(); await page.waitForTimeout(120); };
    const resume = async () => { await page.getByRole('button', { name: '继续播放', exact: true }).click(); };
    await pause(); await page.getByRole('button', { name: '归位', exact: true }).click();
    await page.waitForTimeout(200);
    const frozen = await canvas.screenshot(), frozenTime = await time();
    await page.waitForTimeout(500);
    assert.equal(await time(), frozenTime); assert((await canvas.screenshot()).equals(frozen), 'paused pixels changed');
    checks.push('pause freezes actual rendered pixels and clock');
    await resume(); await page.waitForTimeout(1800); await pause();
    const moving = await canvas.screenshot();
    const { width, height } = await sharp(frozen).metadata();
    const scale = Math.max(width / 1670, height / 941) * 1.045;
    const imagePoint = (x, y) => ({ x: Math.round(width / 2 + (width - 1670 * scale) * -.05 + (x - 835) * scale), y: Math.round(height / 2 + (y - 470.5) * scale) });
    async function difference(a, b, x, y, radius = 14) {
      const center = imagePoint(x, y), rect = { left: center.x - radius, top: center.y - radius, width: radius * 2, height: radius * 2 };
      const aa = await sharp(a).extract(rect).removeAlpha().raw().toBuffer(), bb = await sharp(b).extract(rect).removeAlpha().raw().toBuffer();
      let sum = 0; for (let i = 0; i < aa.length; i++) sum += Math.abs(aa[i] - bb[i]); return sum / aa.length;
    }
    const characterPoint = (x, y) => [rigConfig.placement.x + x * rigConfig.placement.scale, rigConfig.placement.y + y * rigConfig.placement.scale];
    const motionPixels = { face: await difference(frozen, moving, ...characterPoint(765, 155)), hair: await difference(frozen, moving, ...characterPoint(560, 360)), cloth: await difference(frozen, moving, ...characterPoint(515, 800)), chest: await difference(frozen, moving, ...characterPoint(742, 335)), hand: await difference(frozen, moving, ...characterPoint(620, 490)) };
    console.log(JSON.stringify({ motionPixels }));
    await fs.writeFile(path.join(out, 'motion-rest.png'), frozen); await fs.writeFile(path.join(out, 'motion-active.png'), moving);
    assert(motionPixels.face > .1 && motionPixels.hand < .2, 'head must follow breath while the sword hand stays fixed');
    assert(motionPixels.hair > .1 && motionPixels.cloth > .1 && motionPixels.chest > .05, 'regional motions were not visible in rendered pixels');
    checks.push('head and chest breathe; hair and fabric animate; contact hand pixels stay pinned (rigidity separately unit tested)');

    await page.getByRole('slider', { name: '风力', exact: true }).press('Home');
    await page.getByRole('button', { name: '归位', exact: true }).click(); await page.waitForTimeout(100);
    const noWindRest = await canvas.screenshot(); await resume(); await page.waitForTimeout(2100); await pause();
    const noWindInhale = await canvas.screenshot();
    motionPixels.noWindChest = await difference(noWindRest, noWindInhale, ...characterPoint(742, 335));
    motionPixels.noWindFace = await difference(noWindRest, noWindInhale, ...characterPoint(765, 155));
    assert(motionPixels.noWindChest > .1 && motionPixels.noWindFace > .1, 'wind zero incorrectly stopped breathing');
    checks.push('actual rendered chest and head still move with wind at zero');
    await fs.writeFile(path.join(out, 'breath-rest.png'), noWindRest);
    await fs.writeFile(path.join(out, 'breath-inhale.png'), noWindInhale);
    if (process.argv.includes('--motion-only')) {
      console.log(JSON.stringify({ motionPixels, checks, errors })); return;
    }

    await page.getByRole('button', { name: '对照原图', exact: true }).click(); await page.waitForTimeout(700);
    await stage.screenshot({ path: path.join(out, 'original-comparison.png') });
    assert.equal(await page.locator('.living-poster').evaluate(e => getComputedStyle(e).opacity), '1');
    await page.getByRole('button', { name: '返回动态', exact: true }).click();
    await resume();
    await page.getByRole('slider', { name: '风力', exact: true }).press('Home');
    let bounds = await stage.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .12, bounds.y + bounds.height * .5); await page.waitForTimeout(1200);
    const left = await canvas.screenshot({ path: path.join(out, 'parallax-left.png') });
    await page.mouse.move(bounds.x + bounds.width * .88, bounds.y + bounds.height * .5); await page.waitForTimeout(1200);
    const right = await canvas.screenshot({ path: path.join(out, 'parallax-right.png') });
    async function horizontalMotion(a, b, cx, cy) {
      const aa = await sharp(a).removeAlpha().raw().toBuffer(), bb = await sharp(b).removeAlpha().raw().toBuffer();
      let best = { dx: 0, error: Infinity };
      for (let dx = -30; dx <= 30; dx++) {
        let error = 0;
        for (let y = cy - 12; y < cy + 12; y++) for (let x = cx - 12; x < cx + 12; x++) for (let c = 0; c < 3; c++) error += Math.abs(aa[(y * width + x) * 3 + c] - bb[(y * width + x + dx) * 3 + c]);
        if (error < best.error) best = { dx, error };
      }
      return best;
    }
    const face = imagePoint(...characterPoint(765, 155));
    const parallax = { foreground: await horizontalMotion(left, right, face.x - 5, face.y), background: await horizontalMotion(left, right, 190, 160) };
    assert(parallax.foreground.dx > 4 && parallax.background.dx < -4 && parallax.foreground.dx - parallax.background.dx > 12, 'foreground and scenery did not move independently');
    checks.push('independent foreground/background parallax verified by matching actual image patches');
    await stage.focus(); await stage.press('Home'); await stage.press('ArrowLeft'); await page.waitForTimeout(500);
    assert(JSON.parse(await canvas.getAttribute('data-scene-pointer')).x < -.15);
    checks.push('keyboard parallax and reset');
    await page.getByRole('button', { name: '归位', exact: true }).click();
    await page.getByRole('slider', { name: '风力', exact: true }).press('End');

    const performance = await page.evaluate(() => new Promise(resolve => {
      const samples = [], physics = [], start = performance.now(); let previous = start;
      const canvas = document.querySelector('canvas'); const firstSceneFrame = Number(canvas.dataset.sceneFrames), firstSceneTime = Number(canvas.dataset.sceneTime);
      function tick(now) {
        samples.push(now - previous); physics.push(Number(canvas.dataset.scenePhysicsMs)); previous = now;
        if (now - start < 60000) return requestAnimationFrame(tick);
        const sorted = samples.slice(10).sort((a,b) => a-b);
        const sceneFrames = Number(canvas.dataset.sceneFrames)-firstSceneFrame;
        physics.sort((a,b)=>a-b);
        resolve({ windowMs: now-start, rafSamples: samples.length, medianMs: sorted[Math.floor(sorted.length*.5)], p95Ms: sorted[Math.floor(sorted.length*.95)], physicsP95Ms: physics[Math.floor(physics.length*.95)], maxMs: Math.max(...sorted), sceneFrames, sceneCallbackFps: sceneFrames * 1000 / (now-start), sceneSeconds: Number(canvas.dataset.sceneTime)-firstSceneTime, resources: JSON.parse(canvas.dataset.sceneResources), boundary: 'RAF intervals and scene callback count on this headless Chrome GPU; not display presentation or physical mobile proof' });
      }
      requestAnimationFrame(tick);
    }));
    assert(performance.sceneFrames > 1000 && performance.sceneSeconds > 40, 'performance window did not contain active animation');
    checks.push('60 second active animation measurement');
    await page.mouse.move(2, 2); await page.waitForTimeout(300);
    await stage.screenshot({ path: path.join(out, 'scene.png') });
    await page.screenshot({ path: path.join(out, 'desktop-page.png'), fullPage: true });

    // Record the actual WebGL canvas, excluding page chrome and loading frames.
    const recording = page.evaluate(() => new Promise(resolve => {
      const stream = document.querySelector('canvas').captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 5000000 });
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => { stream.getTracks().forEach(track => track.stop()); const buffer = new Uint8Array(await new Blob(chunks).arrayBuffer()); let result = ''; for (let i=0; i<buffer.length; i+=32768) result += String.fromCharCode(...buffer.subarray(i,i+32768)); resolve(btoa(result)); };
      recorder.start(); setTimeout(() => recorder.stop(), 16000);
    }));
    await page.waitForTimeout(3000);
    for (const portion of [.18, .82, .5]) { await page.mouse.move(bounds.x + bounds.width * portion, bounds.y + bounds.height * .55, { steps: 50 }); await page.waitForTimeout(3000); }
    await fs.writeFile(path.join(out, 'render-preview.webm'), Buffer.from(await recording, 'base64'));
    checks.push('16 second recording of the actual browser WebGL canvas');

    // Offscreen pause and resume; no browser-private APIs or synthetic visibility state.
    await page.evaluate(() => { const gap = document.createElement('div'); gap.id = 'verification-scroll-space'; gap.style.height = '1800px'; document.body.append(gap); });
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(300);
    const offscreenTime = await time(); await page.waitForTimeout(500); assert.equal(await time(), offscreenTime);
    await stage.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); const resumed = await time();
    assert(resumed >= offscreenTime && resumed - offscreenTime < .3);
    await page.evaluate(() => document.getElementById('verification-scroll-space').remove());
    checks.push('offscreen pause and resume without accumulating hidden time');

    await page.goto(base + '/scenes/wuxia?view=home', { waitUntil: 'networkidle' });
    await page.locator('.living-portrait[data-state="ready"]').waitFor();
    assert.equal(await page.getByText('还没有正式目标', { exact: true }).count(), 1);
    await page.screenshot({ path: path.join(out, 'home-layout.png'), fullPage: true });
    checks.push('shared scene mounted in the real HomeDashboard slot with explicit public empty state');
    const resources = [];
    for (let i = 0; i < 3; i++) {
      await page.goto(base + '/scenes/wuxia', { waitUntil: 'networkidle' }); await page.locator('.living-portrait[data-state="ready"]').waitFor(); await page.waitForTimeout(150);
      resources.push(JSON.parse(await page.locator('canvas').getAttribute('data-scene-resources')));
    }
    assert(resources.every(item => item.textures === 4 && item.geometries === 2));
    checks.push('three remounts retain expected per-renderer 4 textures / 2 geometries; not a global VRAM leak proof');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(out, 'mobile-viewport.png'), fullPage: true });
    await page.evaluate(() => scrollTo(0, 150)); assert((await page.evaluate(() => scrollY)) > 0);
    assert((await page.locator('canvas').evaluate(c => c.width)) < 400);
    checks.push('390px viewport, no horizontal overflow, scroll and DPR cap');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.living-portrait[data-state="static"]').waitFor();
    assert.equal(await page.locator('canvas').count(), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('.living-portrait[data-state="ready"]').waitFor();
    checks.push('reduced motion unmounts WebGL and retains the baked independent-layer poster');
    await page.locator('canvas').evaluate(c => c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await page.locator('.living-portrait[data-state="error"]').waitFor();
    assert.equal(await page.locator('.living-poster.is-visible').count(), 1);
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.locator('.living-portrait[data-state="ready"]').waitFor();
    checks.push('context loss preserves the composed poster; retry restores WebGL');

    // Failure injection is isolated from the error-free normal rendering run.
    for (const kind of ['network', 'no-webgl', 'no-javascript']) {
      const context = await browser.newContext({ javaScriptEnabled: kind !== 'no-javascript', viewport: { width: 1200, height: 1000 } });
      const probe = await context.newPage();
      if (kind === 'network') await probe.route('**/environment.png', route => route.abort('failed'));
      if (kind === 'no-webgl') await probe.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { if (String(type).startsWith('webgl')) return null; return original.call(this, type, ...args); }; });
      await probe.goto(base + '/scenes/wuxia', { waitUntil: 'networkidle' });
      if (kind !== 'no-javascript') await probe.locator('.living-portrait[data-state="error"]').waitFor({ timeout: 30000 });
      assert.equal(await probe.locator('.living-poster.is-visible').count(), 1);
      await probe.screenshot({ path: path.join(out, kind + '.png'), fullPage: true });
      if (kind === 'network') { await probe.unroute('**/environment.png'); await probe.getByRole('button', { name: '重新加载', exact: true }).click(); await probe.locator('.living-portrait[data-state="ready"]').waitFor(); }
      failures.push({ kind, posterVisible: true, recovered: kind === 'network' }); await context.close();
    }
    checks.push('network failure/retry, unavailable WebGL and JavaScript-disabled poster');
    const manifest = JSON.parse(await fs.readFile('apps/web/public/scenes/wuxia/v2/manifest.json', 'utf8'));
    for (const asset of manifest.assets) {
      const response = await page.request.get(base + '/scenes/wuxia/v2/' + asset.file); assert.equal(response.status(), 200);
      assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'), asset.sha256);
    }
    checks.push('actual HTTP asset bytes match the source build manifest');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(external.length, 0);
    const result = { date: new Date().toISOString(), base, gpu, state, motionPixels, parallax, performance, resources, failures, checks, errors, external, manifest };
    await fs.writeFile(path.join(out, 'browser-checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
