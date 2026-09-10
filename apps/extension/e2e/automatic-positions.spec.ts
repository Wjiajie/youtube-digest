import { chromium, test, expect, type BrowserContext } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { recordLearningPositionSchema, type LearningPosition, type LearningPositionWorkspace } from "@blueprint/domain";

test("built MV3 saves changed positions only after opt-in and stops without resuming after hide", async ({}, info) => {
  const profile = await mkdtemp(resolve(".goal-loop/evidence/automatic-positions-mv3-profile-"));
  const extension = resolve("apps/extension/.output/chrome-mv3");
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 320, height: 1100 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const media = await readFile(resolve("apps/extension/e2e/fixtures/player.webm"));
    const id = (n: number) => `fd740000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const owner = id(1), binding = id(6), otherBinding = id(9), videoId = "abcdefghijk";
    const workspace: LearningPositionWorkspace = { blueprint: { schemaVersion: 2, id: id(2), version: 1, title: "摄影", goals: [{ id: id(3), title: "讲述故事", position: 0,
      stages: [{ id: id(4), title: "观察光线", position: 0, nodes: [
        { id: id(5), type: "learn", title: "比较曝光", position: 0, estimatedMinutes: 30, completionCriteria: "解释画面差异", dependencyIds: [],
          resources: [{ id: binding, kind: "youtube_video", externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }] },
        { id: id(8), type: "learn", title: "比较构图", position: 1, estimatedMinutes: 20, completionCriteria: "说明构图选择", dependencyIds: [],
          resources: [{ id: otherBinding, kind: "youtube_video", externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }] },
      ] }] }] }, records: [] };
    let theme = "cyberpunk";
    const writes: Array<ReturnType<typeof recordLearningPositionSchema.parse>> = [], reads: Array<string | null> = [];
    const unexpectedWrites: string[] = [];
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.hostname === "www.youtube.com") return route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Isolated automatic-position player fixture</title>
        <div id="movie_player"><video class="html5-main-video" preload="auto" src="data:video/webm;base64,${media.toString("base64")}"></video></div>
        <script>const player=document.querySelector('#movie_player'), video=player.querySelector('video');
        player.dataset.positionReads='0';
        player.getVideoData=()=>({video_id:${JSON.stringify(videoId)},isLive:false});
        player.getCurrentTime=()=>{player.dataset.positionReads=String(Number(player.dataset.positionReads)+1);return video.currentTime;};
        player.getDuration=()=>video.duration;</script>` });
      if (request.headers().authorization !== `Bearer fixture-${owner}`) return route.fulfill({ status: 401, json: { code: "unauthenticated" } });
      if (url.pathname === "/api/v1/blueprint") return route.fulfill({ json: workspace.blueprint });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/learning-positions") {
        if (request.method() === "GET") {
          const filter = url.searchParams.get("resourceBindingId"); reads.push(filter);
          return route.fulfill({ json: { blueprint: workspace.blueprint, records: workspace.records.filter(record => !filter || record.resource.bindingId === filter) } });
        }
        expect(request.method()).toBe("POST");
        const command = recordLearningPositionSchema.parse(request.postDataJSON()); writes.push(command);
        expect(command.resourceBindingId).toBe(binding); expect(command.nodeId).toBe(id(5)); expect(command.expectedVersion).toBe(1);
        const previous = workspace.records[0];
        if (command.expectedPositionVersion !== (previous?.positionVersion ?? 0)) return route.fulfill({ status: 409, json: { code: "version_conflict" } });
        const receipt: LearningPosition = { id: id(7), clientMutationId: command.clientMutationId, positionSeconds: command.positionSeconds,
          expectedPositionVersion: command.expectedPositionVersion, positionVersion: command.expectedPositionVersion + 1,
          context: { blueprintId: id(2), blueprintVersion: 1, goalId: id(3), goalTitle: "讲述故事", stageId: id(4), stageTitle: "观察光线", nodeId: id(5), nodeTitle: "比较曝光", nodeType: "learn" },
          resource: { bindingId: binding, videoId, url: `https://www.youtube.com/watch?v=${videoId}` }, createdAt: "2026-09-11T00:00:00Z" };
        workspace.records = [receipt]; return route.fulfill({ json: receipt });
      }
      if (request.method() !== "GET") unexpectedWrites.push(`${request.method()} ${url.pathname}`);
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async owner => { await chrome.storage.local.set({ blueprint_v3_cleanup_complete: true, blueprint_cloud_session_v1: {
      userId: owner, accessToken: `fixture-${owner}`, refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600_000 } }); }, owner);
    const panel = await context.newPage(), errors: string[] = [];
    panel.on("pageerror", error => errors.push(error.message));
    // The harness opens sidepanel.html as an ordinary tab, hidden while YouTube
    // is active. Model a visible sidepanel here; this is NOT evidence about real
    // Chrome Side Panel visibility events or its native window lifecycle.
    await panel.addInitScript(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }));
    await info.attach("visibility-fixture-limitation", { body: "sidepanel.html runs in a regular tab with visibilityState forced to visible while the YouTube fixture is active. This checks built Chrome messaging, real native-media capture and hidden task/section ancestors; it does not verify Chrome's native Side Panel visibility lifecycle.", contentType: "text/plain" });
    const now = Date.now();
    await panel.clock.install({ time: now }); await panel.clock.pauseAt(now + 1000);
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const video = await context.newPage();
    await video.goto(`https://www.youtube.com/watch?v=${videoId}`); await video.bringToFront();
    const nativeReads = async () => Number(await video.locator("#movie_player").getAttribute("data-position-reads"));
    const seek = async (seconds: number) => {
      await video.locator("video").evaluate((element, value) => { const media = element as HTMLVideoElement; media.pause(); media.currentTime = value; }, seconds);
      await expect.poll(() => video.locator("video").evaluate(element => (element as HTMLVideoElement).seeking)).toBe(false);
    };
    const start = panel.getByRole("button", { name: "开启自动保存位置", exact: true });
    const stop = panel.getByRole("button", { name: "停止自动保存位置", exact: true });
    const position = panel.getByLabel("继续学习位置（秒）", { exact: true });
    await expect.poll(() => video.locator("video").evaluate(element => (element as HTMLVideoElement).readyState)).toBe(4);
    await panel.getByRole("button", { name: "继续学习", exact: true }).click();
    await expect(start).toBeDisabled();
    await panel.getByLabel("继续学习关联视频", { exact: true }).selectOption(binding);
    await panel.getByRole("button", { name: "读取所选视频位置", exact: true }).click();
    await panel.getByRole("button", { name: "使用此来源与最新位置版本", exact: true }).click();
    expect(reads).toEqual([null, binding]);
    await expect(start).toBeDisabled(); // Same video alone does not choose a node.
    await panel.getByLabel("本次学习节点", { exact: true }).selectOption(otherBinding);
    await expect(start).toBeDisabled(); // Confirmed draft must match App's binding.
    await panel.getByLabel("本次学习节点", { exact: true }).selectOption(binding);
    await expect(start).toBeEnabled();
    await panel.clock.runFor(60_000);
    expect(writes).toEqual([]); expect(await nativeReads()).toBe(0);

    await seek(2.6); await start.click(); await expect(stop).toBeVisible();
    await panel.clock.runFor(29_999); expect(writes).toEqual([]); expect(await nativeReads()).toBe(0);
    await panel.clock.runFor(1);
    await expect.poll(() => writes.length).toBe(1);
    await expect(position).toHaveValue("2"); await expect(panel.getByText("位置已保存", { exact: true })).toBeVisible();
    expect(writes[0]).toMatchObject({ positionSeconds: 2, expectedPositionVersion: 0 });
    await seek(1.4); await panel.clock.runFor(30_000);
    await expect.poll(() => writes.length).toBe(2);
    await expect(position).toHaveValue("1"); await expect(panel.locator(".position-source")).toContainText("位置版本 2");
    expect(writes[1]).toMatchObject({ positionSeconds: 1, expectedPositionVersion: 1 });
    expect(writes[1]!.clientMutationId).not.toBe(writes[0]!.clientMutationId);
    await panel.clock.runFor(30_000); await expect.poll(nativeReads).toBe(3);
    await panel.clock.runFor(30_000); await expect.poll(nativeReads).toBe(4);
    expect(writes).toHaveLength(2); await expect(stop).toBeVisible();

    await stop.click(); await expect(start).toBeVisible(); await seek(.4);
    const stoppedReads = await nativeReads();
    const expectStopped = async () => {
      await panel.clock.runFor(60_000);
      expect(writes).toHaveLength(2); expect(await nativeReads()).toBe(stoppedReads);
      await expect(start).toBeVisible(); await expect(stop).toHaveCount(0);
    };
    await expectStopped();
    await start.click(); await expect(stop).toBeVisible();
    await panel.getByRole("button", { name: "收起继续学习", exact: true }).click();
    await panel.clock.runFor(60_000); expect(writes).toHaveLength(2); expect(await nativeReads()).toBe(stoppedReads);
    await panel.getByRole("button", { name: "继续学习", exact: true }).click(); await expectStopped();
    await start.click(); await expect(stop).toBeVisible();
    await panel.getByRole("tab", { name: "记录", exact: true }).click();
    await panel.clock.runFor(60_000); expect(writes).toHaveLength(2); expect(await nativeReads()).toBe(stoppedReads);
    await panel.getByRole("tab", { name: "学习", exact: true }).click(); await expectStopped();
    for (const value of ["cyberpunk", "eastern"]) {
      theme = value; await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", value);
      await expect(start).toBeEnabled();
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.screenshot({ path: info.outputPath(`${value}-automatic-positions-320.png`), fullPage: true });
    }
    expect(reads).toEqual([null, binding]); expect(unexpectedWrites).toEqual([]); expect(errors).toEqual([]);
    expect(workspace.records[0]).toMatchObject({ positionSeconds: 1, positionVersion: 2 });
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
