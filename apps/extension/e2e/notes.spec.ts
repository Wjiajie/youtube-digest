import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { recordLearningNoteSchema, type LearningNote, type LearningNoteWorkspace } from "@blueprint/domain";

test("built MV3 notes preserve the original request across video, task, theme and response loss", async ({}, info) => {
  const profile = await mkdtemp(resolve(".goal-loop/evidence/notes-mv3-profile-")), extension = resolve("apps/extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 320, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const id = (n: number) => `fd520000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const owner = id(1), binding = id(6);
    const workspace: LearningNoteWorkspace = { blueprint: { schemaVersion: 2, id: id(2), version: 1, title: "摄影", goals: [{ id: id(3), title: "讲述故事", position: 0,
      stages: [{ id: id(4), title: "观察光线", position: 0, nodes: [{ id: id(5), type: "learn", title: "比较曝光", position: 0, estimatedMinutes: 30,
        completionCriteria: "解释画面差异", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }] }] }] }] }, records: [] };
    let theme = "cyberpunk", drop = true, reads = 0; const writes: unknown[] = [];
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.hostname === "www.youtube.com") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated video fixture</title><h1>Video</h1>" });
      if (request.headers().authorization !== `Bearer fixture-${owner}`) return route.fulfill({ status: 401, json: { code: "unauthenticated" } });
      if (url.pathname === "/api/v1/blueprint") return route.fulfill({ json: workspace.blueprint });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/learning-notes") {
        if (request.method() === "GET") { reads++; return route.fulfill({ json: workspace }); }
        const input = request.postDataJSON(), command = recordLearningNoteSchema.parse(input); writes.push(input);
        const note: LearningNote = workspace.records[0] ?? { id: id(7), clientMutationId: command.clientMutationId, text: command.text, positionSeconds: command.positionSeconds,
          context: { blueprintId: id(2), blueprintVersion: 1, goalId: id(3), goalTitle: "讲述故事", stageId: id(4), stageTitle: "观察光线", nodeId: id(5), nodeTitle: "比较曝光", nodeType: "learn" },
          resource: { bindingId: binding, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }, createdAt: "2026-09-10T00:00:00Z" };
        workspace.records = [note];
        if (drop) { drop = false; return route.abort("failed"); }
        return route.fulfill({ json: note });
      }
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async owner => { await chrome.storage.local.set({ blueprint_v3_cleanup_complete: true, blueprint_cloud_session_v1: {
      userId: owner, accessToken: `fixture-${owner}`, refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600_000 } }); }, owner);
    const panel = await context.newPage(), errors: string[] = []; panel.on("pageerror", error => errors.push(error.message));
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const video = await context.newPage(); await video.goto("https://www.youtube.com/watch?v=abcdefghijk"); await video.bringToFront();
    await panel.getByRole("tab", { name: "记录", exact: true }).click(); expect(reads).toBe(0);
    await panel.getByRole("button", { name: "记录视频笔记", exact: true }).click();
    await panel.getByLabel("笔记关联视频", { exact: true }).selectOption(binding);
    const text = `  保留这次观察的原文。\nhttps://example.test/${"unbrokentext".repeat(12)}`;
    await panel.getByLabel("笔记原文", { exact: true }).fill(text); await panel.getByLabel("视频位置（秒，可选）", { exact: true }).fill("0");
    await panel.getByRole("button", { name: "保存笔记", exact: true }).click();
    await expect(panel.getByText("尚未确认保存结果", { exact: false })).toBeVisible(); expect(writes).toHaveLength(1);
    await video.goto("https://www.youtube.com/watch?v=lmnopqrstuv"); await video.bringToFront();
    await panel.getByRole("tab", { name: "学习", exact: true }).click(); await panel.getByRole("tab", { name: "记录", exact: true }).click();
    await expect(panel.getByLabel("笔记原文", { exact: true })).toHaveValue(text); expect(writes).toHaveLength(1);
    await panel.reload(); await panel.getByRole("tab", { name: "记录", exact: true }).click();
    await panel.getByRole("button", { name: "记录视频笔记", exact: true }).click();
    await expect(panel.getByLabel("笔记原文", { exact: true })).toHaveValue(text);
    await panel.getByRole("button", { name: "确认原笔记提交", exact: true }).focus(); await panel.keyboard.press("Enter");
    await expect(panel.getByText("笔记已保存", { exact: true })).toBeVisible(); expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
    for (const value of ["cyberpunk", "eastern"]) {
      theme = value; await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", value);
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.screenshot({ path: info.outputPath(`${value}-notes-320.png`), fullPage: true });
    }
    await expect(panel.locator('.note-history a[target="_blank"]')).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=0s");
    expect(errors).toEqual([]);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
