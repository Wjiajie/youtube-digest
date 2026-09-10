import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintSnapshot } from "@blueprint/domain";

test("real MV3 keeps explicit learning context, safe return paths and private drafts across video and theme changes", async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(".goal-loop/evidence/extension-context-profile-"));
  const extension = resolve("apps/extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 400, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const id = (suffix: number) => `fd460000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
    const owner = id(1), other = id(2), goal = id(3), firstNode = id(5), secondNode = id(6), firstBinding = id(7), secondBinding = id(8);
    const snapshot: BlueprintSnapshot = { schemaVersion: 2, id: id(9), version: 3, title: "我的摄影蓝图", goals: [{ id: goal, title: "用照片讲述故事", position: 0,
      stages: [{ id: id(4), title: "观察光线", position: 0, nodes: [firstNode, secondNode].map((nodeId, index) => ({ id: nodeId, type: "learn", position: index,
        title: index ? "独立完成曝光练习" : "理解曝光组合", description: index ? "在同一场景比较光圈与快门，记录自己的选择理由。" : "先观察画面变化，再判断参数之间的联系。",
        estimatedMinutes: index ? 45 : 20, completionCriteria: index ? "提交三张照片，并解释参数取舍。" : "用自己的话说明曝光变化。", dependencyIds: [],
        resources: [{ id: index ? secondBinding : firstBinding, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] })) }] }] };
    let theme = "cyberpunk", offline = false;
    const writes: Array<{ nodeId: string; resourceBindingId: string }> = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.hostname === "www.youtube.com") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated video page fixture</title><h1>Video fixture</h1>" });
      if (url.pathname.startsWith("/paths/")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated path destination</title>" });
      const isOwner = route.request().headers().authorization === `Bearer fixture-${owner}`;
      if (url.pathname === "/api/v1/blueprint") return offline ? route.abort("failed") : route.fulfill({ json: isOwner ? snapshot : { ...snapshot, id: other, goals: [] } });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/progress-evidence" && route.request().method() === "GET") return route.fulfill({ json: [] });
      if (url.pathname === "/api/v1/learning-sessions" && route.request().method() === "POST") {
        expect(isOwner).toBe(true); writes.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: { ok: true } });
      }
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const signIn = (userId: string) => worker.evaluate(async userId => {
      await chrome.storage.local.set({ blueprint_v3_cleanup_complete: true, blueprint_cloud_session_v1: {
        userId, accessToken: `fixture-${userId}`, refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600_000 } });
    }, userId);
    await signIn(owner);
    const panel = await context.newPage(), errors: string[] = [];
    panel.on("pageerror", error => errors.push(error.message));
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const video = await context.newPage();
    await video.goto("https://www.youtube.com/watch?v=abcdefghijk");
    await video.bringToFront();
    await expect(panel.getByLabel("本次学习节点", { exact: true })).toHaveValue("");
    await expect(panel.getByRole("button", { name: "开始学习", exact: true })).toHaveCount(0);
    await panel.getByLabel("本次学习节点", { exact: true }).focus();
    await expect(panel.getByLabel("本次学习节点", { exact: true })).toBeFocused();
    // macOS headless native-select arrows also fail on a plain HTML select.
    // Verify native selection via Playwright; keyboard activation is checked below.
    await panel.getByLabel("本次学习节点", { exact: true }).selectOption(secondBinding);
    await expect(panel.getByLabel("本次学习节点", { exact: true })).toHaveValue(secondBinding);
    await expect(panel.getByText("提交三张照片，并解释参数取舍。", { exact: true })).toBeVisible();
    await expect(panel.getByText("45 分钟", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "开始学习", exact: true }).focus();
    await panel.getByRole("button", { name: "开始学习", exact: true }).press("Enter");
    await expect(panel.getByText("学习会话已写入你的蓝图。", { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ nodeId: secondNode, resourceBindingId: secondBinding });
    await panel.getByRole("button", { name: "记录学习收获", exact: true }).click();
    await panel.getByLabel("关联路径节点", { exact: true }).selectOption(secondNode);
    await panel.getByLabel("这次的收获", { exact: true }).fill("准备重拍三张照片，先保留这份私人草稿。");
    await panel.getByRole("button", { name: "收起成果记录", exact: true }).click();
    for (const selected of ["cyberpunk", "eastern"]) {
      theme = selected;
      await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", selected);
      await expect(panel.getByLabel("本次学习节点", { exact: true })).toHaveValue(secondBinding);
      await panel.setViewportSize({ width: 320, height: 900 });
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await panel.screenshot({ path: testInfo.outputPath(`${selected}-context-320.png`), fullPage: true });
    }
    const opened = context.waitForEvent("page");
    await panel.getByRole("button", { name: "返回此节点路径", exact: true }).click();
    const path = await opened;
    await expect.poll(() => path.url()).toMatch(new RegExp(`/paths/${goal}#node-${secondNode}$`));
    await video.bringToFront();
    await expect(panel.getByLabel("本次学习节点", { exact: true })).toHaveValue("");
    await panel.getByLabel("本次学习节点", { exact: true }).selectOption(secondBinding);
    offline = true;
    await panel.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(panel.getByText("当前显示缓存蓝图，网络恢复后可刷新。", { exact: true })).toBeVisible();
    await expect(panel.getByLabel("本次学习节点", { exact: true })).toHaveValue(secondBinding);
    offline = false;
    await video.goto("https://www.youtube.com/watch?v=lmnopqrstuv");
    await expect(panel.getByRole("heading", { name: "没有匹配的蓝图节点", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "开始学习", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "记录学习收获", exact: true }).click();
    await expect(panel.getByLabel("这次的收获", { exact: true })).toHaveValue("准备重拍三张照片，先保留这份私人草稿。");
    await expect(panel.getByLabel("关联路径节点", { exact: true })).toHaveValue(secondNode);
    await signIn(other);
    await expect(panel.getByLabel("这次的收获", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("提交三张照片，并解释参数取舍。", { exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(1); expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});
