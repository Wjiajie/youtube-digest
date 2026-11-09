const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3100/scenes/wuxia', { waitUntil: 'networkidle' });
    await page.locator('.living-portrait[data-state="ready"]').waitFor();
    const session = await context.newCDPSession(page), stage = await page.getByTestId('living-stage').boundingBox();
    const startY = Math.min(650, stage.y + 300);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: startY }] });
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: startY - step * 22 }] });
      await page.waitForTimeout(22);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const scroll = await page.evaluate(() => scrollY), canvas = page.locator('canvas');
    assert(scroll > 20, 'native emulated touch gesture did not scroll the page');
    const bufferWidth = await canvas.evaluate(canvas => canvas.width);
    assert(bufferWidth <= 390, 'mobile DPR cap not respected');
    const out = path.resolve('.goal-loop/evidence', process.argv.includes('--v2') ? 'wuxia-living-v2-2026-10-17/production' : 'wuxia-living-2026-10-17/production');
    await fs.mkdir(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'touch-emulation.png'), fullPage: true });
    const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
    await page.waitForTimeout(200);
    const visibility = await page.evaluate(() => document.visibilityState);
    let tabPause = 'not exercised: browser kept background page visible';
    if (visibility === 'hidden') {
      const before = await canvas.getAttribute('data-scene-time'); await page.waitForTimeout(500);
      assert.equal(await canvas.getAttribute('data-scene-time'), before);
      await page.bringToFront(); await page.waitForTimeout(200);
      tabPause = 'background tab clock frozen; foreground restored';
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    const result = { viewport: [390, 844], emulatedDevicePixelRatio: 3, canvasWidth: bufferWidth, scrollY: scroll, gesture: 'Chrome native CDP touchStart/move/end over artwork', tabVisibility: visibility, tabPause, errors, boundary: 'Emulated Chrome touch, not an Android or iPhone device' };
    await fs.writeFile(path.join(out, 'touch-checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
