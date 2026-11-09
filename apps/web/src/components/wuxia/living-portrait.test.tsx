// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LivingCanvasProps } from "./living-portrait-canvas";
import { LivingPortrait } from "./living-portrait";

vi.mock("next/dynamic", () => ({ default: () => function CanvasProbe(props: LivingCanvasProps) {
  return <div data-testid="canvas-probe" data-active={props.active}>
    <button onClick={props.onReady}>simulate ready</button><button onClick={props.onError}>simulate error</button>
  </div>;
} }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("IntersectionObserver", class {
    callback: (entries: { isIntersecting: boolean }[]) => void;
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent === text)!;
  await act(async () => button.click());
}
test("poster is present before rendering and throughout failure; retry creates a fresh scene", async () => {
  await act(async () => root.render(<LivingPortrait />));
  const poster = host.querySelector("img")!;
  expect(poster.alt).toContain("白衣侠女"); expect(poster.className).toContain("is-visible");
  await click("simulate ready"); expect(poster.className).not.toContain("is-visible");
  await click("simulate error");
  expect(poster.className).toContain("is-visible"); expect(host.querySelector('[data-testid="canvas-probe"]')).toBeNull();
  await click("重新加载"); expect(host.querySelector('[data-testid="canvas-probe"]')).not.toBeNull();
  await click("simulate ready"); expect(poster.className).not.toContain("is-visible");
});
test("pause and original comparison stop animation while controls remain reversible", async () => {
  await act(async () => root.render(<LivingPortrait />));
  await click("simulate ready");
  const active = () => host.querySelector('[data-testid="canvas-probe"]')?.getAttribute("data-active");
  expect(active()).toBe("true");
  await click("暂停动效"); expect(active()).toBe("false");
  await click("继续播放"); expect(active()).toBe("true");
  await click("对照原图"); expect(active()).toBe("false");
  expect(host.querySelector("img")?.className).toContain("is-visible");
  await click("返回动态"); expect(active()).toBe("true");
});
test("reduced motion preserves artwork without initializing WebGL", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  await act(async () => root.render(<LivingPortrait />));
  expect(host.querySelector('[data-testid="canvas-probe"]')).toBeNull();
  expect(host.querySelector("img")?.className).toContain("is-visible");
  expect(host.textContent).toContain("减少动态效果");
});

test("visibility events stop and resume the scheduler without changing the user's pause preference", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => root.render(<LivingPortrait />)); await click("simulate ready");
  const active = () => host.querySelector('[data-testid="canvas-probe"]')?.getAttribute("data-active");
  expect(active()).toBe("true");
  await act(async () => { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  expect(active()).toBe("false");
  await act(async () => { visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); });
  expect(active()).toBe("true");
  await click("暂停动效");
  await act(async () => { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange")); });
  expect(active()).toBe("false");
});
