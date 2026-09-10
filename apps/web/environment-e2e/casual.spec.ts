import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { fiveJointFixture } from "../src/lib/scene/skin-fixture";

// Optional acquired-asset journey: actual model bytes and the existing preview UI.
for (const filename of ["Casual.gltf", "Casual.source-study.glb", "Casual.weight-repaired-study.glb", "Casual.full-influence-study.glb"]) test(`${filename} avatar renders and idle playback stops under reduced motion`, async ({ page }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) external.push(url.origin);
  });
  await page.goto("/design/assets");
  await expect(page.getByRole("heading", { name: "人物与环境资产 · 实时试装", exact: true })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await page.getByLabel("选择内嵌 glTF 2.0 / GLB 2.0（最多 10 MB）", { exact: true })
    .setInputFiles(resolve(".tools/asset-intake/quaternius-women", filename));
  await expect(page.getByText(`已解析 ${filename}`, { exact: false })).toContainText("24 个动作");
  const canvas = page.locator("canvas");
  // Establish a settled static image before checking the real rendered animation.
  await page.waitForTimeout(300);
  const still = await canvas.screenshot({ path: info.outputPath("casual-still.png") });
  await page.waitForTimeout(250);
  expect((await canvas.screenshot()).equals(still)).toBe(true);
  await page.getByRole("checkbox", { name: "播放中性待机（减少动态效果时暂停）", exact: true }).check();
  await expect.poll(async () => (await canvas.screenshot()).equals(still)).toBe(false);
  await page.waitForTimeout(400);
  await canvas.screenshot({ path: info.outputPath("casual-idle.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  const paused = await canvas.screenshot({ path: info.outputPath("casual-reduced-motion.png") });
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(paused)).toBe(true);
  if (filename === "Casual.full-influence-study.glb") {
    // Exclude the parent's CSS-rounded edge: error text shifts its subpixel clipping.
    const captureInterior = async () => {
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Expected the retained canvas");
      return page.screenshot({ clip: { x: box.x + 16, y: box.y + 16, width: box.width - 32, height: box.height - 32 } });
    };
    const retained = await captureInterior();
    await page.getByLabel("选择内嵌 glTF 2.0 / GLB 2.0（最多 10 MB）", { exact: true }).setInputFiles({
      name: "unsupported.glb", mimeType: "model/gltf-binary", buffer: Buffer.from(fiveJointFixture({ JOINTS_2: 3, WEIGHTS_2: 4 })),
    });
    await expect(page.getByText("试装最多支持八个骨骼影响", { exact: false })).toBeVisible();
    expect((await captureInterior()).equals(retained)).toBe(true);
  }
  console.info(await canvas.evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext("webgl2")!;
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }));
  await page.getByRole("button", { name: "清除场景", exact: true }).click();
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]); expect(external).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});
