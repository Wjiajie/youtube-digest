// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ThemePicker } from "./theme-picker";
import { ThemeSurface, type ThemeId } from "./theme";

test("a labelled native theme selector changes the same surface without submitting its surrounding form", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const submitted = vi.fn();
  function Screen() {
    const [theme, setTheme] = useState<ThemeId>("cyberpunk");
    return <ThemeSurface theme={theme} density="compact"><form onSubmit={submitted}>
      <ThemePicker value={theme} onChange={setTheme} />
      <textarea aria-label="未提交的记录" defaultValue="保留内容" />
    </form></ThemeSurface>;
  }
  try {
    await act(async () => root.render(<Screen />));
    const select = host.querySelector("select")!;
    expect(select.labels?.[0].textContent).toContain("界面主题");
    const note = host.querySelector("textarea");
    await act(async () => {
      select.value = "eastern";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.firstElementChild?.getAttribute("data-bp-theme")).toBe("eastern");
    expect(host.querySelector("textarea")).toBe(note);
    expect(submitted).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
