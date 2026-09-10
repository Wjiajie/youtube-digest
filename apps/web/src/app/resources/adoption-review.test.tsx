// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AdoptionReview, AdoptionStart } from "./adoption-review";
import type { AdoptionView, AdoptionReviewProps } from "./adoption-view";
const account = "10000000-0000-4000-8000-000000000001", id = "10000000-0000-4000-8000-000000000002", proposalId = "10000000-0000-4000-8000-000000000003";
const initial: AdoptionView = { id, sourceRunId: id, nodeId: id, nodeTitle: "PRIVATE_NODE", goalId: id, goalTitle: "PRIVATE_GOAL", blueprintVersion: 3,
  status: "ready", selected: { videoId: "abcdefghijk", title: "PRIVATE_VIDEO", channel: "Camera" }, replaceBindingId: null, outcome: "verified",
  verifiedAt: "2026-09-10T00:00:00Z", validUntil: "2026-09-10T00:10:00Z", before: [], after: [{ id: proposalId, videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk" }],
  proposal: { id: proposalId, status: "pending", appliedVersion: null } };
function props(overrides: Partial<AdoptionReviewProps> = {}): AdoptionReviewProps {
  return { accountId: account, initial, readAction: async () => ({ ok: true, value: initial }), cancelAction: async () => ({ ok: true, value: { ...initial, status: "cancelled" } }),
    rejectAction: async () => ({ ok: true, value: { ...initial, status: "rejected", proposal: { id: proposalId, status: "rejected", appliedVersion: null } } }),
    applyAction: async () => ({ ok: true, value: { ...initial, status: "applied", proposal: { id: proposalId, status: "applied", appliedVersion: 4 } } }), ...overrides };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll("button")].find(el => el.textContent === text)!;
test("reviewing a prepared proposal does not apply it; explicit confirmation updates the receipt and path link", async () => {
  const apply = vi.fn(props().applyAction);
  await act(async () => root.render(<AdoptionReview {...props({ applyAction: apply })} />));
  expect(apply).not.toHaveBeenCalled(); expect(host.textContent).toContain("PRIVATE_VIDEO");
  await act(async () => button("确认并绑定资源").click());
  expect(apply).toHaveBeenCalledExactlyOnceWith(proposalId, 3);
  expect(host.textContent).toContain("已绑定到正式路径"); expect(host.querySelector(`a[href="/paths/${id}?node=${id}"]`)).not.toBeNull();
});

test("a single explicit verification keeps its recovery link even when the response is lost", async () => {
  let resolve!: (value: Response) => void;
  const network = new Promise<Response>(done => { resolve = done; }), fetcher = vi.fn<typeof fetch>(() => network); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<AdoptionStart accountId={account} sourceRunId={id} videoId="abcdefghijk" bindings={[]} enabled onIdentityLost={() => {}} />));
  expect(fetcher).not.toHaveBeenCalled(); await act(async () => button("核验并准备采用").click());
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body).toEqual({ kind: "adopt", adoptionId: expect.any(String), sourceRunId: id, videoId: "abcdefghijk", replaceBindingId: null, accountId: account });
  const link = host.querySelector<HTMLAnchorElement>(`a[href="/resources/adoptions/${body.adoptionId}"]`)!;
  expect(link.target).toBe("_blank"); expect(link.rel).toContain("noopener");
  await act(async () => resolve(new Response("lost response", { status: 502 })));
  expect(host.textContent).toContain("结果尚未确认"); expect(button("核验并准备采用").disabled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
});

test("unknown confirmation blocks another write until an explicit read resolves its outcome", async () => {
  const apply = vi.fn(async () => { throw new Error("private network error"); });
  await act(async () => root.render(<AdoptionReview {...props({ applyAction: apply })} />));
  await act(async () => button("确认并绑定资源").click());
  expect(button("确认并绑定资源").disabled).toBe(true); expect(button("拒绝这份资源变更").disabled).toBe(true); expect(host.textContent).not.toContain("private network error");
  await act(async () => button("读取采用记录").click()); expect(button("确认并绑定资源").disabled).toBe(false); expect(apply).toHaveBeenCalledTimes(1);
});

test("identity loss hides private proposal contents and stale records can be rejected but not applied", async () => {
  await act(async () => root.render(<AdoptionReview {...props({ initial: { ...initial, status: "stale" }, readAction: async () => ({ ok: false, code: "forbidden" }) })} />));
  expect(button("确认并绑定资源")).toBeUndefined(); expect(button("拒绝这份资源变更").disabled).toBe(false);
  await act(async () => button("读取采用记录").click()); expect(host.textContent).not.toContain("PRIVATE_"); expect(host.textContent).toContain("身份已变化");
});

test("verification times are readable with an explicit timezone and preserve machine-readable instants", async () => {
  await act(async () => root.render(<AdoptionReview {...props()} />));
  const times = [...host.querySelectorAll("time")];
  expect(times.map(time => time.dateTime)).toEqual([initial.verifiedAt, initial.validUntil]);
  expect(host.textContent).toContain("北京时间");
  expect(times[0].textContent).toContain("08:00"); expect(times[1].textContent).toContain("08:10");
  expect(times[0].textContent).not.toContain("T00:00:00Z");
});
