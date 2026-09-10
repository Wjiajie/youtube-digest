import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(".tools/asset-intake/kenney-nature/Models/GLTF format");
const names = ["rock_largeA.glb", "rock_tallA.glb", "tree_pineTallA.glb", "tree_plateau.glb"];
const files = names.map(name => resolve(directory, name));

test("real local environment files form both compositions and remain usable after failures and context loss", async ({ page }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(new URL(request.url()).origin); });
  await page.goto("/design/environment");
  await expect(page.getByRole("heading", { name: "让目标世界有自己的风景", exact: true })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  const input = page.getByLabel("选择四件环境 GLB（合计最多 10 MB）", { exact: true });
  await input.setInputFiles(files);
  await expect(page.getByText(/已绘制首帧/)).toBeVisible();
  for (const theme of ["eastern", "cyberpunk"]) {
    await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
    await expect(page.getByText(/已绘制首帧/)).toBeVisible();
    await page.locator(".environment-stage").screenshot({ path: info.outputPath(`${theme}-standard.png`) });
    await page.getByRole("combobox", { name: "场景画质", exact: true }).selectOption("low");
    await expect(page.getByText(/已绘制首帧/)).toBeVisible();
    await page.locator(".environment-stage").screenshot({ path: info.outputPath(`${theme}-low.png`) });
    await page.setViewportSize({ width: 320, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${theme}-narrow.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole("combobox", { name: "场景画质", exact: true }).selectOption("standard");
  }
  const renderer = await page.locator("canvas").evaluate(canvas => {
    const context = (canvas as HTMLCanvasElement).getContext("webgl2")!;
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    return extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
  });
  console.info(`Actual WebGL renderer: ${renderer}; this is not hardware FPS acceptance.`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("checkbox", { name: "使用二维文字视图", exact: true }).check();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "二维文字视图", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "使用二维文字视图", exact: true }).uncheck();
  await expect(page.getByText(/已绘制首帧/)).toBeVisible();

  // Observe real GL draw calls, not component internals or a mock Canvas.
  await page.locator("canvas").evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2")!;
    const draw = gl.drawElements.bind(gl);
    canvas.setAttribute("data-observed-draws", "0");
    gl.drawElements = (...args) => {
      canvas.setAttribute("data-observed-draws", String(Number(canvas.getAttribute("data-observed-draws")) + 1));
      return draw(...args);
    };
  });
  // Let initial demand invalidations settle, then verify a quiet sample window.
  await page.waitForTimeout(200);
  const quiet = await page.locator("canvas").getAttribute("data-observed-draws");
  await page.waitForTimeout(250);
  await expect(page.locator("canvas")).toHaveAttribute("data-observed-draws", quiet!);
  await page.getByRole("button", { name: "向左观察", exact: true }).click();
  await expect.poll(async () => Number(await page.locator("canvas").getAttribute("data-observed-draws"))).toBeGreaterThan(Number(quiet));
  await page.getByRole("button", { name: "重置镜头", exact: true }).click();

  const before = await page.locator("canvas").count();
  await input.setInputFiles(files.slice(1));
  await expect(page.getByText(/四个不重复/)).toBeVisible();
  expect(await page.locator("canvas").count()).toBe(before);
  await expect(page.getByText(/已绘制首帧/)).toBeVisible();
  const corrupted = files.map((file, index) => ({ name: names[index], mimeType: "model/gltf-binary", buffer: index === 3 ? Buffer.from("broken") : readFileSync(file) }));
  await input.setInputFiles(corrupted);
  await expect(page.getByText(/数据块无效/)).toBeVisible();
  await expect(page.getByText(/已绘制首帧/)).toBeVisible();
  await page.locator("canvas").evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2")!;
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Test browser lacks actual context-loss support");
    extension.loseContext();
  });
  await expect(page.getByRole("heading", { name: "3D 暂不可用", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试 3D", exact: true }).click();
  await expect(page.getByText(/已绘制首帧/)).toBeVisible();
  await page.getByRole("button", { name: "清除环境", exact: true }).click();
  await expect(page.locator("canvas")).toHaveCount(0);
  await input.setInputFiles(files);
  await expect(page.getByText(/已绘制首帧/)).toBeVisible();
  await page.getByRole("button", { name: "清除环境", exact: true }).click();
  expect(external).toEqual([]); expect(errors).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test("clearing while local file reading is in flight cannot resurrect a late environment", async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this);
      await new Promise(resolve => setTimeout(resolve, 80));
      document.documentElement.dataset.completedFileReads = String(Number(document.documentElement.dataset.completedFileReads ?? 0) + 1);
      return bytes;
    };
  });
  await page.goto("/design/environment");
  await page.getByLabel("选择四件环境 GLB（合计最多 10 MB）", { exact: true }).setInputFiles(files);
  await expect(page.getByText("正在本地校验四件环境……", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除环境", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-completed-file-reads", "4");
  await expect(page.getByRole("heading", { name: "等待真实环境资产", exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByLabel("选择四件环境 GLB（合计最多 10 MB）", { exact: true }).setInputFiles(files);
  await expect(page.getByText(/已绘制首帧/)).toBeVisible();
});

test("a browser without WebGL retains the local file workflow and honest text fallback", async ({ browser }, info) => {
  const context = await browser.newContext();
  // Browser capability seam only: never replace our renderer or its modules.
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof getContext>) {
      if (String(args[0]).startsWith("webgl")) return null;
      return getContext.apply(this, args);
    };
  });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto("http://127.0.0.1:3101/design/environment");
    await page.getByLabel("选择四件环境 GLB（合计最多 10 MB）", { exact: true }).setInputFiles(files);
    await expect(page.getByRole("heading", { name: "3D 暂不可用", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "清除环境", exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath("no-webgl.png"), fullPage: true });
    await page.getByRole("button", { name: "清除环境", exact: true }).click();
    await expect(page.getByRole("heading", { name: "等待真实环境资产", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
