// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ClarificationStart, type StartClarificationCommand } from "./clarification-start";
import type { ClarificationSessionView, ClarificationUiResult } from "./clarification-view";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
it("keeps one explicit start command and a recovery link after an uncertain response", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pending = Promise.withResolvers<{ ok: false; code: "unavailable" }>();
  const start = vi.fn((_input: StartClarificationCommand) => pending.promise), host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<ClarificationStart accountId="owner" briefId="brief" expectedBriefRevision={0} enabled={false} startAction={start} />));
    await act(async () => { host.querySelector("button")!.click(); host.querySelector("button")!.click(); });
    expect(start).toHaveBeenCalledTimes(1);
    const input = start.mock.calls[0][0];
    expect(input).toMatchObject({ briefId: "brief", expectedBriefRevision: 0 });
    expect(host.querySelector(`a[href="/clarification/${input.sessionId}"]`)).not.toBeNull();
    await act(async () => pending.resolve({ ok: false, code: "unavailable" }));
    expect(host.textContent).toContain("尚未确认");
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("重试本次"))!.click());
    expect(start.mock.calls[1][0]).toEqual(input);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); navigation.push.mockReset(); }
});
it("does not navigate to the previous account's session after identity changes during creation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const response = Promise.withResolvers<ClarificationUiResult<ClarificationSessionView>>();
  const start = vi.fn((_input: StartClarificationCommand) => response.promise);
  const host = document.createElement("div"), root = createRoot(host);
  const render = (accountId: string) => <ClarificationStart accountId={accountId} briefId="brief" expectedBriefRevision={0} enabled={false} startAction={start} />;
  try {
    await act(async () => root.render(render("first")));
    await act(async () => host.querySelector("button")!.click());
    const command = start.mock.calls[0][0];
    await act(async () => root.render(render("second")));
    await act(async () => response.resolve({ ok: true, value: { id: command.sessionId, briefId: command.briefId,
      sourceRevision: 1, revision: 1, updatedAt: "2026-09-10T00:00:00Z", status: "active", mode: "needs_input", question: "目标？",
      content: { schemaVersion: 1, outcome: "", startingPoint: "", targetDate: null, weeklyMinutes: null, constraints: "", successCriteria: "" } } }));
    expect(host.textContent).toContain("身份已变化");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(host.querySelector("a")).toBeNull();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); navigation.push.mockReset(); }
});
