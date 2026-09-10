import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { recordLearningPositionSchema, type LearningPosition, type LearningPositionWorkspace } from "@blueprint/domain";

test("built MV3 explicitly saves and recovers source-bound positions without tracking or retargeting", async ({}, info) => {
  const profile = await mkdtemp(resolve(".goal-loop/evidence/positions-mv3-profile-")), extension = resolve("apps/extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 320, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const media = await readFile(resolve("apps/extension/e2e/fixtures/player.webm"));
    const id = (n: number) => `fd580000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const owner = id(1), binding = id(6);
    const workspace: LearningPositionWorkspace = { blueprint: { schemaVersion: 2, id: id(2), version: 1, title: "摄影", goals: [{ id: id(3), title: "讲述故事", position: 0,
      stages: [{ id: id(4), title: "观察光线", position: 0, nodes: [{ id: id(5), type: "learn", title: "比较曝光", position: 0, estimatedMinutes: 30,
        completionCriteria: "解释画面差异", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] }, records: [] };
    let theme = "cyberpunk", drop = true; const writes: unknown[] = [], reads: Array<string | null> = [];
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.hostname === "www.youtube.com") return route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Isolated player fixture</title>
        <div id="movie_player"><video class="html5-main-video" preload="auto" src="data:video/webm;base64,${media.toString("base64")}"></video></div>
        <script>const player=document.querySelector('#movie_player'), video=player.querySelector('video');
        player.getVideoData=()=>({video_id:${JSON.stringify(url.searchParams.get("v"))},isLive:false});
        player.getCurrentTime=()=>video.currentTime; player.getDuration=()=>video.duration;</script>` });
      if (request.headers().authorization !== `Bearer fixture-${owner}`) return route.fulfill({ status: 401, json: { code: "unauthenticated" } });
      if (url.pathname === "/api/v1/blueprint") return route.fulfill({ json: workspace.blueprint });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/learning-positions") {
        if (request.method() === "GET") {
          const filter = url.searchParams.get("resourceBindingId"); reads.push(filter);
          return route.fulfill({ json: { blueprint: workspace.blueprint, records: workspace.records.filter(record => !filter || record.resource.bindingId === filter) } });
        }
        const input = request.postDataJSON(), command = recordLearningPositionSchema.parse(input); writes.push(input);
        const receipt: LearningPosition = workspace.records.find(record => record.clientMutationId === command.clientMutationId) ?? {
          id: id(7), clientMutationId: command.clientMutationId, positionSeconds: command.positionSeconds,
          expectedPositionVersion: command.expectedPositionVersion, positionVersion: command.expectedPositionVersion + 1,
          context: { blueprintId: id(2), blueprintVersion: command.expectedVersion, goalId: id(3), goalTitle: "讲述故事", stageId: id(4), stageTitle: "观察光线", nodeId: id(5), nodeTitle: "比较曝光", nodeType: "learn" },
          resource: { bindingId: binding, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }, createdAt: "2026-09-11T00:00:00Z" };
        workspace.records = [receipt];
        if (drop) { drop = false; return route.abort("failed"); }
        return route.fulfill({ json: receipt });
      }
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async owner => { await chrome.storage.local.set({ blueprint_v3_cleanup_complete: true, blueprint_cloud_session_v1: {
      userId: owner, accessToken: `fixture-${owner}`, refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600_000 } }); }, owner);
    const panel = await context.newPage(), errors: string[] = []; panel.on("pageerror", error => errors.push(error.message));
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const video = await context.newPage(); await video.goto("https://www.youtube.com/watch?v=abcdefghijk"); await video.bringToFront();
    expect(reads).toEqual([]); expect(writes).toEqual([]);
    await panel.getByRole("button", { name: "继续学习", exact: true }).click();
    await panel.getByLabel("继续学习关联视频", { exact: true }).selectOption(binding);
    await panel.getByRole("button", { name: "读取所选视频位置", exact: true }).click();
    await panel.getByRole("button", { name: "使用此来源与最新位置版本", exact: true }).click();
    expect(reads).toEqual([null, binding]);
    await expect.poll(() => video.locator("video").evaluate(element => (element as HTMLVideoElement).readyState)).toBe(4);
    await video.locator("video").evaluate(element => { (element as HTMLVideoElement).currentTime = 2.6; });
    await expect.poll(() => video.locator("video").evaluate(element => (element as HTMLVideoElement).seeking)).toBe(false);
    await video.bringToFront();
    await panel.getByRole("button", { name: "读取当前播放位置", exact: true }).click();
    await expect(panel.getByLabel("继续学习位置（秒）", { exact: true })).toHaveValue("2"); expect(writes).toEqual([]);
    await panel.getByRole("button", { name: "保存继续学习位置", exact: true }).focus(); await panel.keyboard.press("Enter");
    await expect(panel.getByText("尚未确认保存结果", { exact: false })).toBeVisible(); expect(writes).toHaveLength(1);
    await expect(panel.getByLabel("继续学习位置（秒）", { exact: true })).toBeDisabled();
    await video.goto("https://www.youtube.com/watch?v=lmnopqrstuv"); await video.bringToFront();
    await panel.getByRole("tab", { name: "记录", exact: true }).click(); await panel.getByRole("tab", { name: "学习", exact: true }).click();
    await expect(panel.getByLabel("继续学习位置（秒）", { exact: true })).toHaveValue("2"); expect(writes).toHaveLength(1);
    await panel.getByRole("button", { name: "收起继续学习", exact: true }).click(); await panel.getByRole("button", { name: "继续学习", exact: true }).click();
    expect(reads).toEqual([null, binding]);
    theme = "eastern"; await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", "eastern");
    await expect(panel.getByLabel("继续学习位置（秒）", { exact: true })).toHaveValue("2"); expect(writes).toHaveLength(1);
    await panel.reload(); await panel.getByRole("button", { name: "继续学习", exact: true }).click();
    await expect(panel.getByLabel("继续学习位置（秒）", { exact: true })).toHaveValue("2"); expect(writes).toHaveLength(1);
    await panel.getByRole("button", { name: "确认原位置提交", exact: true }).focus(); await panel.keyboard.press("Enter");
    await expect(panel.getByText("位置已保存", { exact: true })).toBeVisible(); expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
    await expect(panel.locator('.position-history a[target="_blank"]')).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=2s");
    for (const value of ["cyberpunk", "eastern"]) {
      theme = value; await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", value);
      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 1000 });
        expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await panel.screenshot({ path: info.outputPath(`${value}-positions-${width}.png`), fullPage: true });
      }
    }
    // Stable binding identity alone cannot turn an old-video receipt into the new video's resume time.
    workspace.blueprint.version = 2;
    const resource = workspace.blueprint.goals[0]!.stages[0]!.nodes[0]!.resources[0]!;
    resource.externalId = "lmnopqrstuv"; resource.url = "https://www.youtube.com/watch?v=lmnopqrstuv";
    await panel.getByLabel("继续学习关联视频", { exact: true }).selectOption(binding);
    await panel.getByRole("button", { name: "读取所选视频位置", exact: true }).click();
    await expect(panel.getByText("属于历史来源", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: "使用此来源与最新位置版本", exact: true }).click();
    await expect(panel.getByLabel("继续学习位置（秒）", { exact: true })).toHaveValue("");
    expect(writes).toHaveLength(2); expect(errors).toEqual([]);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
