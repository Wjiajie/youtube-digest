import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const directory = resolve(".tools/asset-intake/quaternius-nature");

// Optional, acquired local-asset journey; not part of the hermetic unit suite.
// Observe the existing File API / WebGL seam, without replacing the app loader.
test("Birch base-color study renders locally while the external-resource original remains rejected", async ({ page }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) external.push(url.origin);
  });
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (...args) {
      const result = draw.apply(this, args);
      if (this.canvas instanceof HTMLCanvasElement) {
        this.canvas.dataset.observedDraws = String(Number(this.canvas.dataset.observedDraws ?? 0) + 1);
      }
      return result;
    };
  });
  await page.goto("/design/assets");
  await expect(page.getByRole("heading", { name: "人物与环境资产 · 实时试装", exact: true })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  const input = page.getByLabel("选择内嵌 glTF 2.0 / GLB 2.0（最多 10 MB）", { exact: true });
  await expect(input).toBeEnabled();
  await page.screenshot({ path: info.outputPath("ready.png"), fullPage: true });
  await input.setInputFiles(resolve(directory, "BirchTree_1.base-color-study.gltf"));
  await expect(page.getByText(/已解析 BirchTree_1.base-color-study.gltf/)).toBeVisible();
  const canvas = page.locator("canvas");
  await expect.poll(async () => Number(await canvas.getAttribute("data-observed-draws"))).toBeGreaterThan(0);
  await page.getByRole("region", { name: "资产实时渲染，拖动旋转，滚轮缩放", exact: true }).screenshot({ path: info.outputPath("birch-front.png") });
  const renderer = await canvas.evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext("webgl2")!;
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.info(`Birch actual renderer: ${renderer}; base-color-only, not hardware performance acceptance.`);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing rendered canvas bounds");
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .55, { steps: 12 });
  await page.mouse.up();
  await canvas.screenshot({ path: info.outputPath("birch-orbit.png") });
  await input.setInputFiles(resolve(directory, "BirchTree_1.gltf"));
  await expect(page.getByText(/当前已加载场景不变/)).toBeVisible();
  await expect(page.getByText(/已解析 BirchTree_1.base-color-study.gltf/)).toBeVisible();
  await expect(canvas).toHaveCount(1);
  await page.getByRole("button", { name: "清除场景", exact: true }).click();
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});
