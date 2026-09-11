import { expect, test, type Page } from "@playwright/test";
import { answer, disabled, explanationAccount, origin, provider } from "./fixture.mts";
test.use({ hasTouch: true });

async function selectOriginalFragment(page: Page) {
  // A real browser Range reaches the same native-selection handler as drag or
  // Shift+arrow selection; no source content is supplied to the application.
  await page.locator('[data-explanation-segment="20"]').evaluate(element => {
    const text = element.firstChild;
    if (!text) throw new Error("Original paragraph unavailable");
    const range = document.createRange(); range.setStart(text, 5); range.setEnd(text, 17);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    element.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
  await expect(page.locator(".explanation-workspace blockquote")).toHaveText("用自己的照片解释你的选择");
}

test("the real signed-in reader previews, explains, restyles and restores one exact selection without storing its body", async ({ page, request }, info) => {
  test.skip(disabled);
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`);
    await owner.acquire();
    await page.context().addCookies(owner.cookies.map(cookie => ({ ...cookie, url: origin })));
    await page.goto(`/learn/${owner.bindingId}`);
    await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    const paragraph = page.getByRole("button", { name: "选择第 21 段讲解", exact: true });
    await paragraph.focus(); await page.keyboard.press("Enter");
    await expect(page.locator(".explanation-workspace blockquote")).toHaveText("最后一段：用自己的照片解释你的选择。");
    await page.getByRole("textbox", { name: "讲解问题（可选）", exact: true }).fill("怎样练习？");
    await selectOriginalFragment(page);
    await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption("eastern");
    await expect(page.getByRole("textbox", { name: "讲解问题（可选）", exact: true })).toHaveValue("怎样练习？");
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
    await page.getByRole("button", { name: "讲解这段原文", exact: true }).click();
    await expect(page.getByRole("region", { name: "讲解结果", exact: true })).toBeVisible();
    await expect(page.getByText(answer.meaning, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "第 21 段 · 回看原文 ↗", exact: true })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=300s");
    for (const theme of ["cyberpunk", "eastern"]) {
      await page.getByRole("combobox", { name: "界面主题", exact: true }).selectOption(theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(page.getByText(answer.meaning, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator(".explanation-workspace button").evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height >= 44))).toBe(true);
        const recheck = page.getByRole("button", { name: "核对原讲解", exact: true }); await recheck.focus();
        await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(recheck).toBeFocused();
        expect(await recheck.evaluate(element => element.matches(":focus-visible"))).toBe(true);
        expect(await recheck.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
        await page.locator(".explanation-workspace").scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`explanation-${theme}-${width}.png`) });
      }
    }
    await page.reload();
    await expect(page.getByRole("textbox", { name: "讲解问题（可选）", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.getByRole("button", { name: "选择第 21 段讲解", exact: true }).tap();
    await selectOriginalFragment(page);
    await page.getByRole("textbox", { name: "讲解问题（可选）", exact: true }).fill("怎样练习？");
    await page.getByRole("button", { name: "查找已有讲解", exact: true }).click();
    await expect(page.getByText(answer.meaning, { exact: true })).toBeVisible();
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([{ path: "/chat/completions", method: "POST" }]);
    expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]
      .some(value => ["怎样练习？", "用自己的照片解释你的选择", "用自己的照片表达和解释选择。"].some(text => value.includes(text))))).toBe(false);
  } finally { await page.context().clearCookies(); await owner.cleanup(); }
});

test("a signed-in learner can edit a draft when the generation gate is explicitly disabled", async ({ page, request }) => {
  test.skip(!disabled);
  const owner = await explanationAccount();
  try {
    await request.post(`${provider}/fixture/reset`); await owner.acquire();
    await page.context().addCookies(owner.cookies.map(cookie => ({ ...cookie, url: origin })));
    await page.goto(`/learn/${owner.bindingId}`);
    await page.getByRole("button", { name: "读取原始字幕", exact: true }).click();
    await page.getByRole("button", { name: "下一页", exact: true }).click(); await selectOriginalFragment(page);
    const field = page.getByRole("textbox", { name: "讲解问题（可选）", exact: true }); await field.fill("怎样练习？");
    await page.getByRole("button", { name: "讲解这段原文", exact: true }).tap();
    await expect(page.getByText(/讲解暂未开启，本次发起未进入生成/)).toBeVisible(); await expect(field).toBeEnabled();
    await field.fill("先保留另一个问题"); await expect(field).toHaveValue("先保留另一个问题");
    await expect(page.getByRole("button", { name: "核对原讲解", exact: true })).toHaveCount(0);
    expect(await (await request.get(`${provider}/fixture/calls`)).json()).toEqual([]);
  } finally { await page.context().clearCookies(); await owner.cleanup(); }
});
