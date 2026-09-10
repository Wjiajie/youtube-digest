import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintSnapshot, NodeStatusRecord } from "@blueprint/domain";

test("real MV3 assessment requires criteria acknowledgement and recovers the original confirmation across reload, themes and account changes", async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(".goal-loop/evidence/extension-assessment-profile-"));
  const extension = resolve("apps/extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 400, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const id = (suffix: number) => `fd470000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
    const owner = id(1), other = id(2), nodeId = id(5);
    const snapshot: BlueprintSnapshot = { schemaVersion: 2, id: id(9), version: 4, title: "我的表达蓝图", goals: [{ id: id(3), title: "清楚表达观点", position: 0,
      stages: [{ id: id(4), title: "第一次演讲", position: 0, nodes: [{ id: nodeId, type: "practice", title: "完成三分钟演讲", position: 0,
        estimatedMinutes: 45, completionCriteria: "录制三分钟演讲，并写下两点改进。", dependencyIds: [], resources: [] }] }] }] };
    const records: NodeStatusRecord[] = [];
    let theme = "cyberpunk", lostReceipt = true, posts = 0, reads = 0;
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.hostname === "www.youtube.com") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated video fixture</title>" });
      const isOwner = route.request().headers().authorization === `Bearer fixture-${owner}`;
      const blueprint = isOwner ? snapshot : { ...snapshot, id: other, goals: [] };
      if (url.pathname === "/api/v1/blueprint") return route.fulfill({ json: blueprint });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/node-status") {
        if (route.request().method() === "GET") {
          reads++; return route.fulfill({ json: { blueprint, current: isOwner ? records : [], history: isOwner ? records : [], evidence: { ok: true, value: [] } } });
        }
        expect(isOwner).toBe(true); posts++;
        const command = route.request().postDataJSON();
        expect(command).toMatchObject({ nodeId, expectedVersion: 4, expectedStatusRevision: 0, status: "completed", evidenceId: null });
        let receipt = records.find(record => record.clientMutationId === command.clientMutationId);
        if (!receipt) {
          expect(records).toHaveLength(0);
          receipt = { id: id(10), clientMutationId: command.clientMutationId,
            context: { blueprintId: snapshot.id, blueprintVersion: 4, goalId: id(3), goalTitle: "清楚表达观点", stageId: id(4), stageTitle: "第一次演讲", nodeId, nodeTitle: "完成三分钟演讲", nodeType: "practice" },
            estimatedMinutes: 45, completionCriteria: "录制三分钟演讲，并写下两点改进。", status: "completed", revision: 1, evidenceId: null, createdAt: "2026-09-10T12:00:00Z" };
          records.push(receipt);
        }
        if (lostReceipt) { lostReceipt = false; return route.abort("failed"); }
        return route.fulfill({ json: receipt });
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
    await expect(panel.getByRole("button", { name: "核对节点状态", exact: true })).toBeVisible();
    expect(reads).toBe(0); expect(posts).toBe(0);
    await panel.getByRole("button", { name: "核对节点状态", exact: true }).click();
    await panel.getByLabel("路径节点", { exact: true }).selectOption(nodeId);
    await panel.getByLabel("我的状态判断", { exact: true }).selectOption("completed");
    await expect(panel.getByText("录制三分钟演讲，并写下两点改进。", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "确认节点状态", exact: true })).toBeDisabled();
    await panel.getByLabel("我已核对完成依据，明确作出自我确认", { exact: true }).check();
    await panel.getByRole("button", { name: "确认节点状态", exact: true }).click();
    await expect(panel.getByText("暂时无法确认保存结果，请保留当前选择。", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "收起节点状态", exact: true }).click();
    await panel.getByRole("button", { name: "核对节点状态", exact: true }).click();
    expect(posts).toBe(1);
    await panel.reload();
    await panel.getByRole("button", { name: "核对节点状态", exact: true }).click();
    await expect(panel.getByLabel("路径节点", { exact: true })).toHaveValue(nodeId);
    await expect(panel.getByLabel("路径节点", { exact: true })).toBeDisabled();
    await panel.getByRole("button", { name: "确认原提交结果", exact: true }).click();
    await expect(panel.getByText("状态确认已保存。当前状态以重新读取的云端记录为准，不代表系统认证掌握。", { exact: true })).toBeVisible();
    expect(posts).toBe(2); expect(records).toHaveLength(1);
    await expect(panel.locator(".node-status-history article")).toHaveCount(1);
    for (const selected of ["cyberpunk", "eastern"]) {
      theme = selected;
      await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(panel.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", selected);
      await expect(panel.getByLabel("路径节点", { exact: true })).toHaveValue(nodeId);
      await panel.setViewportSize({ width: 320, height: 900 });
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await panel.screenshot({ path: testInfo.outputPath(`${selected}-assessment-320.png`), fullPage: true });
    }
    const video = await context.newPage(); await video.goto("https://www.youtube.com/watch?v=abcdefghijk"); await video.bringToFront();
    await expect(panel.getByRole("heading", { name: "没有匹配的蓝图节点", exact: true })).toBeVisible();
    await expect(panel.getByLabel("路径节点", { exact: true })).toHaveValue(nodeId);
    expect(posts).toBe(2);
    await signIn(other);
    await expect(panel.getByLabel("路径节点", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "核对节点状态", exact: true }).click();
    await expect(panel.locator(".node-status-history article")).toHaveCount(0);
    await expect(panel.getByLabel("路径节点", { exact: true })).toHaveValue("");
    expect(errors).toEqual([]);
  } finally { await context.close(); await rm(profile, { recursive: true }); }
});
