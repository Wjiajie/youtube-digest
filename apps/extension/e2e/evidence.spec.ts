import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintSnapshot, ProgressEvidence } from "@blueprint/domain";

test("real MV3 journal preserves uncertain drafts, themes and account isolation with external HTTP fixtures", async ({}, testInfo) => {
  // Isolated extension profile on the workspace volume; never the user's browser.
  const profile = await mkdtemp(resolve(".goal-loop/evidence/extension-profile-"));
  const extension = resolve("apps/extension/.output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 400, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const owner = "018f6f68-9b4d-7c93-a134-c8571b8f7801", other = "018f6f68-9b4d-7c93-a134-c8571b8f7802";
    const nodeId = "018f6f68-9b4d-7c93-a134-c8571b8f7803";
    const snapshot: BlueprintSnapshot = { schemaVersion: 1, id: owner, version: 1, title: "我的蓝图", goals: [{
      id: "018f6f68-9b4d-7c93-a134-c8571b8f7804", title: "表达能力", position: 0, stages: [{
        id: "018f6f68-9b4d-7c93-a134-c8571b8f7805", title: "第一周", position: 0,
        nodes: [{ id: nodeId, type: "practice", title: "完成三分钟演讲", position: 0, dependencyIds: [], resources: [] }],
      }],
    }] };
    const records: ProgressEvidence[] = [];
    let theme = "cyberpunk", loseReceipt = true, writes = 0;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      const isOwner = route.request().headers().authorization === `Bearer fixture-${owner}`;
      if (url.pathname === "/api/v1/blueprint") return route.fulfill({ json: isOwner ? snapshot : { ...snapshot, id: other, goals: [] } });
      if (url.pathname === "/api/v1/account-preferences") return route.fulfill({ json: { theme: { id: theme, version: 1 }, revision: 1 } });
      if (url.pathname === "/api/v1/progress-evidence") {
        if (route.request().method() !== "POST") return route.fulfill({ json: isOwner ? records : [] });
        expect(isOwner).toBe(true);
        const input = route.request().postDataJSON();
        let saved = records.find((entry) => entry.clientMutationId === input.clientMutationId);
        if (!saved) {
          writes++;
          saved = { id: crypto.randomUUID(), clientMutationId: input.clientMutationId, text: input.text, artifactUrl: input.artifactUrl,
            createdAt: "2026-09-10T00:00:00Z", context: { blueprintId: owner, blueprintVersion: 1,
              goalId: snapshot.goals[0]!.id, goalTitle: "表达能力", stageId: snapshot.goals[0]!.stages[0]!.id,
              stageTitle: "第一周", nodeId, nodeTitle: "完成三分钟演讲", nodeType: "practice" } };
          records.unshift(saved);
        }
        if (loseReceipt) { loseReceipt = false; return route.abort("failed"); }
        return route.fulfill({ json: saved });
      }
      // No real network fallback: auth, telemetry, YouTube and other providers
      // are outside this fixture-based runtime check.
      return route.abort("blockedbyclient");
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const signIn = (userId: string) => worker.evaluate(async (id) => {
      await chrome.storage.local.set({ blueprint_v3_cleanup_complete: true,
        blueprint_cloud_session_v1: { userId: id, accessToken: `fixture-${id}`, refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600_000 } });
    }, userId);
    await signIn(owner);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
    await page.getByRole("tab", { name: "记录", exact: true }).click();
    await page.getByRole("button", { name: "记录学习收获", exact: true }).click();
    await page.getByLabel("关联路径节点", { exact: true }).selectOption(nodeId);
    await page.getByLabel("这次的收获", { exact: true }).fill("第一次演讲完成，下一次放慢语速。");
    await page.getByRole("button", { name: "保存私人记录", exact: true }).click();
    await expect(page.getByText("尚不能确认是否保存。", { exact: false })).toBeVisible();
    await page.getByRole("tab", { name: "学习", exact: true }).click();
    await expect(page.getByLabel("这次的收获", { exact: true })).toBeHidden();
    await page.getByRole("tab", { name: "记录", exact: true }).click();
    await expect(page.getByText("尚不能确认是否保存。", { exact: false })).toBeVisible();
    expect(writes).toBe(1);
    await page.reload();
    await expect(page.getByRole("tab", { name: "学习", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "记录", exact: true }).click();
    await page.getByRole("button", { name: "记录学习收获", exact: true }).click();
    await page.getByRole("button", { name: "确认原提交结果", exact: true }).click();
    await expect(page.getByText("记录已保存，仅自己可见。", { exact: false })).toBeVisible();
    expect(writes).toBe(1);
    await expect(page.locator("article")).toHaveCount(1);
    await page.getByLabel("这次的收获", { exact: true }).fill("下一次练习的私人草稿。");
    for (const selected of ["cyberpunk", "eastern"]) {
      theme = selected;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator("[data-bp-theme]")).toHaveAttribute("data-bp-theme", selected);
      await expect(page.getByLabel("这次的收获", { exact: true })).toHaveValue("下一次练习的私人草稿。");
      await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${selected}-320.png`), fullPage: true });
    }
    await signIn(other);
    await expect(page.getByLabel("这次的收获", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "学习", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "记录", exact: true }).click();
    await page.getByRole("button", { name: "记录学习收获", exact: true }).click();
    await expect(page.getByLabel("这次的收获", { exact: true })).toHaveValue("");
    await expect(page.locator("article")).toHaveCount(0);
    await signIn(owner);
    await expect(page.getByRole("tab", { name: "学习", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "记录", exact: true }).click();
    await page.getByRole("button", { name: "记录学习收获", exact: true }).click();
    await expect(page.getByLabel("这次的收获", { exact: true })).toHaveValue("下一次练习的私人草稿。");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});
