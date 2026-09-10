import { chromium, test, expect, type Route } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

test("built MV3 reads only the selected video's original captions and discards late navigation replies", async ({}, info) => {
  const profile = await mkdtemp(resolve(".goal-loop/evidence/transcript-mv3-profile-")), extension = resolve("apps/extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 320, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let held: Route | undefined;
  try {
    const id = (n: number) => `ef680000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const owner = id(1), binding = id(6), source = id(7), videoId = "abcdefghijk";
    const snapshot = { schemaVersion: 2, id: id(2), version: 1, title: "摄影", goals: [{ id: id(3), title: "用影像讲述生活", position: 0,
      stages: [{ id: id(4), title: "观察光线", position: 0, nodes: [{ id: id(5), type: "learn", title: "比较曝光", position: 0, estimatedMinutes: 30,
        completionCriteria: "解释画面差异", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }] }] }] }] };
    let theme = "cyberpunk", defer = false; const requests: URL[] = [];
    const caption = (offset: number) => ({ ownerId: owner, context: { bindingId: binding, nodeId: id(5), nodeTitle: "比较曝光", goalId: id(3), goalTitle: "用影像讲述生活", videoId },
      observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: source, sourceBlueprintVersion: 0, sourceCreatedAt: "2026-09-10T00:00:00Z",
      contentExpiresAt: "2026-09-11T00:10:00Z", title: "Exposure · Learn to see the light", language: "en", offset, totalSegments: 21,
      segments: offset ? [{ text: "最后一段：先观察，再调整。", offsetMs: 300000, durationMs: 10000 }] : Array.from({ length: 20 }, (_, i) => ({
        text: `${i + 1}. Observe the light before changing exposure. 观察光线，记录你的判断。`, offsetMs: i * 15000, durationMs: 10000 })) });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.hostname === "www.youtube.com") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated video fixture</title><main>Video fixture</main>" });
      if (request.headers().authorization !== `Bearer fixture-${owner}`) return route.fulfill({ status: 401, json: { code: "unauthenticated" } });
      if (url.pathname === "/api/v1/blueprint") return route.fulfill({ json: snapshot });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/learning-transcript") {
        requests.push(url);
        expect(url.searchParams.get("bindingId")).toBe(binding); expect(url.searchParams.get("videoId")).toBe(videoId);
        if (defer) { held = route; return; }
        return route.fulfill({ json: caption(Number(url.searchParams.get("offset"))) });
      }
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async owner => { await chrome.storage.local.set({ blueprint_v3_cleanup_complete: true, blueprint_cloud_session_v1: {
      userId: owner, accessToken: `fixture-${owner}`, refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600000 } }); }, owner);
    const panel = await context.newPage(), errors: string[] = []; panel.on("pageerror", error => errors.push(error.message));
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const video = await context.newPage(); await video.goto(`https://www.youtube.com/watch?v=${videoId}`); await video.bringToFront();
    await panel.getByRole("tab", { name: "理解", exact: true }).click(); expect(requests).toHaveLength(0);
    await panel.getByRole("button", { name: "读取原始字幕", exact: true }).click(); await expect(panel.locator(".transcript-segments li")).toHaveCount(20);
    await panel.getByRole("button", { name: "下一页", exact: true }).click(); await expect(panel.getByText("最后一段：先观察，再调整。", { exact: true })).toBeVisible();
    expect(requests[1]?.searchParams.get("sourceRunId")).toBe(source);
    await panel.getByRole("tab", { name: "记录", exact: true }).click(); await panel.getByRole("tab", { name: "理解", exact: true }).click();
    await expect(panel.getByText("最后一段：先观察，再调整。", { exact: true })).toBeVisible(); expect(requests).toHaveLength(2);
    for (const next of ["cyberpunk", "eastern"]) {
      theme = next; await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", next);
      await expect(panel.locator(".transcript-segments")).toHaveCount(0);
      await panel.getByRole("button", { name: "重新读取字幕", exact: true }).click();
      await expect(panel.getByText("最后一段：先观察，再调整。", { exact: true })).toBeVisible();
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await panel.screenshot({ path: info.outputPath(`${next}-transcript-mv3-320.png`), fullPage: true });
    }
    const stored = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    expect(stored).not.toContain("Observe the light"); expect(stored).not.toContain("最后一段");
    defer = true; await panel.getByRole("button", { name: "查找最新字幕", exact: true }).click(); await expect.poll(() => Boolean(held)).toBe(true);
    await video.goto("https://www.youtube.com/watch?v=zyxwvutsrqp");
    await expect(panel.getByText("没有匹配的蓝图节点", { exact: true })).toBeVisible();
    await held!.fulfill({ json: caption(0) }); held = undefined;
    await expect(panel.locator(".transcript-segments")).toHaveCount(0); expect(errors).toEqual([]);
  } finally { if (held) await held.abort().catch(() => undefined); await context.close(); await rm(profile, { recursive: true, force: true }); }
});
