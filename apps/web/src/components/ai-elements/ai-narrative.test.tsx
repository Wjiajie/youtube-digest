// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AiNarrative } from "./ai-narrative";

it("renders readable emphasis but never turns model output into navigation, media or executable HTML", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<AiNarrative>{"**先确认目标**\n\n[查看](https://example.test/private) ![跟踪](https://example.test/pixel)\n\n<script>window.PWNED=true</script><iframe src='https://example.test/embed'></iframe>\n\n- 一次一个问题"}</AiNarrative>));
    expect(host.querySelector("strong")?.textContent).toBe("先确认目标");
    expect(host.textContent).toContain("一次一个问题");
    expect(host.querySelector("a,img,video,audio,iframe,script,object,embed,form")).toBeNull();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
