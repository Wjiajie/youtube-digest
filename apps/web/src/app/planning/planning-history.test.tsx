// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PlanningHistory } from "./planning-history";
it("hides the private history and heading when generation detects identity loss", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async () => Response.json({ ok: false, code: "unauthenticated" }, { status: 401 }));
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<PlanningHistory start={{ accountId: "owner", briefId: "brief", briefRevision: 1, blueprintVersion: 0, confirmed: true, enabled: true }}
      heading={<h1>PRIVATE_OUTCOME</h1>}><p>PRIVATE_HISTORY</p></PlanningHistory>));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(host.textContent).not.toContain("PRIVATE_"); expect(host.textContent).toContain("重新登录");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
