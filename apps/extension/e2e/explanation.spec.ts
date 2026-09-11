import { chromium, test, expect, type Route } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExplanationContext } from "@blueprint/ui/explanation-view";

// Built MV3 UI and real background adapter; synthetic HTTP responses and session.
// This does not exercise hosted OAuth, an Edge worker, a model, or native Side Panel chrome.
test("built MV3 explains an explicit selection, preserves both-theme drafts and recovers without another generation", async ({}, info) => {
  const profile = await mkdtemp(resolve(".goal-loop/evidence/explanation-mv3-profile-"));
  const extension = resolve("apps/extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, hasTouch: true, viewport: { width: 320, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let held: Route | undefined;
  try {
    const id = (n: number) => `ef860000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const owner = id(1), binding = id(6), source = id(7), videoId = "abcdefghijk";
    const question = "为什么要先观察光线？", meaning = "先观察现场的明暗分布，再比较曝光调整的结果。";
    const snapshot = { schemaVersion: 2, id: id(2), version: 1, title: "摄影", goals: [{ id: id(3), title: "用影像讲述生活", position: 0,
      stages: [{ id: id(4), title: "观察光线", position: 0, nodes: [{ id: id(5), type: "learn", title: "比较曝光", position: 0, estimatedMinutes: 30,
        completionCriteria: "解释画面差异", dependencyIds: [], resources: [{ id: binding, kind: "youtube_video", externalId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }] }] }] }] };
    const caption = { ownerId: owner, context: { bindingId: binding, nodeId: id(5), nodeTitle: "比较曝光", goalId: id(3), goalTitle: "用影像讲述生活", videoId },
      observedAt: "2026-09-11T00:00:00Z", status: "ready", sourceRunId: source, sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
      contentExpiresAt: "2026-09-11T00:10:00Z", title: "Exposure · Learn to see the light", language: "en", offset: 0, totalSegments: 3,
      segments: Array.from({ length: 3 }, (_, i) => ({ text: `${i + 1}. Observe the light and compare two examples before changing exposure.`, offsetMs: i * 15000, durationMs: 10000 })) };
    let theme = "cyberpunk", saved: (ExplanationContext & { runId: string; accountId: string }) | null = null;
    let startCalls = 0, findCalls = 0, failNextRead = true, defer = false, gateDisabled = false;
    const receipt = () => ({ ok: true, run: saved ? { runId: saved.runId, accountId: owner, status: "ready",
      context: { bindingId: binding, videoId, sourceRunId: source, offset: 0 }, targetLanguage: "zh-Hans",
      observedAt: caption.observedAt, contentExpiresAt: caption.contentExpiresAt, selection: saved.selection, question: saved.question,
      result: { status: "explained", providerMayHaveRun: true, usage: null, answer: { kind: "explanation", meaning,
        reasoning: "原文先说观察光线，再说比较两个示例；这里解释的是这一先后关系。",
        background: "曝光可以影响画面明暗；这是一般背景，并非视频中新的事实。", checkQuestion: "你会先观察画面的哪个区域？",
        limitations: ["此处是固定测试讲解，不构成模型质量评测。"], evidence: [{ segmentIndex: 0, quote: "Observe the light" }] } } } : null });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.hostname === "www.youtube.com") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated video fixture</title><main>Video fixture</main>" });
      if (request.headers().authorization !== `Bearer fixture-${owner}`) return route.fulfill({ status: 401, json: { code: "unauthenticated" } });
      if (url.pathname === "/api/v1/blueprint") return route.fulfill({ json: snapshot });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/learning-transcript") return route.fulfill({ json: caption });
      if (url.pathname === "/api/v1/translations/runs" && request.method() === "GET") return route.fulfill({ json: { ok: true, run: null } });
      if (url.pathname.startsWith("/api/v1/explanations/runs")) {
        expect(decodeURIComponent(url.search)).not.toContain(question);
        if (url.pathname.endsWith("/find")) {
          expect(request.method()).toBe("POST"); findCalls++;
          const command = request.postDataJSON();
          expect(command).toMatchObject({ accountId: owner, bindingId: binding, videoId, sourceRunId: source, offset: 0, question });
          if (saved) expect(command.selection).toEqual(saved.selection);
          return route.fulfill({ json: receipt() });
        }
        if (url.pathname === "/api/v1/explanations/runs") {
          expect(request.method()).toBe("POST");
          if (gateDisabled) return route.fulfill({ status: 503, json: { ok: false, code: "disabled" } });
          startCalls++;
          const command = request.postDataJSON();
          expect(command).toMatchObject({ accountId: owner, bindingId: binding, videoId, sourceRunId: source, offset: 0, question,
            selection: { start: { segmentIndex: 0, charOffset: 3 }, end: { segmentIndex: 0, charOffset: 20 } } });
          saved = command;
          return route.fulfill({ json: { ok: true, runId: command.runId, status: "ready" } });
        }
        if (saved && url.pathname === `/api/v1/explanations/runs/${saved.runId}` && request.method() === "GET") {
          if (defer) { held = route; return; }
          if (failNextRead) { failNextRead = false; return route.fulfill({ status: 503, json: { error: "Isolated gateway fixture" } }); }
          return route.fulfill({ json: receipt() });
        }
      }
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async owner => { await chrome.storage.local.set({ blueprint_v3_cleanup_complete: true, blueprint_cloud_session_v1: {
      userId: owner, accessToken: `fixture-${owner}`, refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600000 } }); }, owner);
    const panel = await context.newPage(), errors: string[] = []; panel.on("pageerror", error => errors.push(error.message));
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    const video = await context.newPage(); await video.goto(`https://www.youtube.com/watch?v=${videoId}`); await video.bringToFront();
    await panel.getByRole("tab", { name: "理解", exact: true }).click();
    await panel.getByRole("button", { name: "读取原始字幕", exact: true }).click();
    const paragraph = panel.getByRole("button", { name: "选择第 1 段讲解", exact: true });
    await paragraph.focus(); await expect(paragraph).toBeFocused(); await paragraph.press("Enter");
    await expect(panel.locator(".explanation-workspace blockquote")).toHaveText(caption.segments[0]!.text);
    const field = panel.getByRole("textbox", { name: "讲解问题（可选）", exact: true });
    await field.fill(question);
    await panel.getByRole("tab", { name: "记录", exact: true }).click(); await expect(field).toBeHidden();
    await panel.getByRole("tab", { name: "理解", exact: true }).click(); await expect(field).toHaveValue(question);
    for (const next of ["cyberpunk", "eastern"]) {
      theme = next; await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", next);
      await expect(field).toHaveCount(0);
      await panel.getByRole("button", { name: "重新读取字幕", exact: true }).click();
      await expect(field).toHaveValue(question);
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const button of await panel.locator(".explanation-workspace button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await panel.screenshot({ path: info.outputPath(`${next}-explanation-draft-mv3-320.png`), fullPage: true });
    }
    expect(startCalls).toBe(0); expect(findCalls).toBe(0);
    await panel.getByRole("button", { name: "收起选文", exact: true }).click();
    // Browser-native Selection/Range exercises the same pointer handler as a drag.
    const selectNative = async () => panel.locator('[data-explanation-segment="0"]').evaluate(element => {
      const text = element.firstChild!;
      const range = document.createRange(); range.setStart(text, 3); range.setEnd(text, 20);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      selection.removeAllRanges();
    });
    await selectNative();
    await expect(panel.locator(".explanation-workspace blockquote")).toHaveText("Observe the light");
    await field.fill(question); expect(startCalls).toBe(0);
    gateDisabled = true;
    await panel.getByRole("button", { name: "讲解这段原文", exact: true }).tap();
    await expect(panel.getByText(/讲解暂未开启，本次发起未进入生成/)).toBeVisible(); await expect(field).toBeEnabled();
    expect(startCalls).toBe(0); gateDisabled = false;
    await panel.getByRole("button", { name: "讲解这段原文", exact: true }).click();
    await expect(panel.getByText(/结果尚未确认，旧答案已隐藏/)).toBeVisible();
    await expect(panel.getByRole("region", { name: "讲解结果", exact: true })).toHaveCount(0);
    expect(startCalls).toBe(1); expect(findCalls).toBe(2);
    await panel.getByRole("button", { name: "核对原讲解", exact: true }).click();
    await expect(panel.getByText(meaning, { exact: true })).toBeVisible(); expect(startCalls).toBe(1);
    for (const next of ["cyberpunk", "eastern"]) {
      theme = next; await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", next);
      await panel.getByRole("button", { name: "重新读取字幕", exact: true }).click();
      await expect(field).toHaveValue(question);
      await panel.getByRole("button", { name: "核对原讲解", exact: true }).click();
      await expect(panel.getByText(meaning, { exact: true })).toBeVisible();
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(panel.getByRole("heading", { name: "一般背景 · 非原文事实", exact: true })).toBeVisible();
      await expect(panel.getByRole("link", { name: "第 1 段 · 回看原文 ↗", exact: true })).toHaveAttribute("href", `https://www.youtube.com/watch?v=${videoId}&t=0s`);
      await panel.screenshot({ path: info.outputPath(`${next}-explanation-answer-mv3-320.png`), fullPage: true });
    }
    await panel.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const verify = panel.getByRole("button", { name: "核对原讲解", exact: true });
    await verify.focus(); await verify.press("Tab"); await panel.keyboard.press("Shift+Tab"); await expect(verify).toBeFocused();
    expect(await verify.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await panel.screenshot({ path: info.outputPath("explanation-mv3-forced-colors-320.png"), fullPage: true });
    await panel.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    await panel.reload(); await video.bringToFront(); await panel.getByRole("tab", { name: "理解", exact: true }).click();
    await panel.getByRole("button", { name: "读取原始字幕", exact: true }).click(); await selectNative();
    await field.fill(question); await panel.getByRole("button", { name: "查找已有讲解", exact: true }).click();
    await expect(panel.getByText(meaning, { exact: true })).toBeVisible(); expect(startCalls).toBe(1);
    const stored = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    expect(stored).not.toContain("Observe the light"); expect(stored).not.toContain(question); expect(stored).not.toContain(meaning);
    defer = true; await verify.click(); await expect.poll(() => Boolean(held)).toBe(true);
    await video.goto("https://www.youtube.com/watch?v=zyxwvutsrqp");
    await expect(panel.getByText("没有匹配的蓝图节点", { exact: true })).toBeVisible();
    await held!.fulfill({ json: receipt() }); held = undefined;
    await expect(panel.locator(".explanation-workspace")).toHaveCount(0);
    expect(startCalls).toBe(1); expect(errors).toEqual([]);
  } finally {
    if (held) await held.abort().catch(() => undefined);
    await context.close(); await rm(profile, { recursive: true, force: true });
  }
});
