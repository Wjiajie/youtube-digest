// @vitest-environment jsdom
import { TextDecoder, TextEncoder } from "node:util";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPreferences } from "@/lib/companion/contracts";
import { CompanionHome } from "./companion-home";

vi.mock("./avatar-stage", async () => {
  const React = await import("react");
  return {
    AvatarStage: () =>
      React.createElement(
        "div",
        { "data-testid": "avatar-stage" },
        "Shayna 全身场景",
      ),
  };
});
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children }: { href: string; children: ReactNode }) =>
      React.createElement("a", { href }, children),
  };
});

const actionId = "182f1082-ef59-4ede-a4b2-cd217c0244b",
  conversationId = "6bf71a65-dc76-46c6-9c56-3777d378bb5a";
const proposal = {
  id: actionId,
  kind: "goal",
  status: "pending",
  receipt: null,
  source_message_id: "6c9f1f70-998c-4df1-b7f1-6a1949c354d8",
  created_at: "2026-10-18T12:00:00Z",
  expires_at: "2026-10-18T12:30:00Z",
  payload: {
    content: {
      schemaVersion: 1,
      outcome: "完成三组摄影练习",
      startingPoint: "掌握基础操作",
      weeklyMinutes: 120,
      successCriteria: "拍摄并复盘三组照片",
      constraints: "",
      targetDate: null,
    },
  },
};
let root: Root,
  host: HTMLDivElement,
  requests: any[],
  messages: any[],
  actions: any[];
let handleText: (body: any, signal?: AbortSignal | null) => Response;
let confirmFailure: boolean;
function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 17)
          controller.enqueue(bytes.slice(offset, offset + 17));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
function addMessage(role: string, text: string, id = crypto.randomUUID()) {
  messages.push({
    id,
    role,
    text,
    modality: "text",
    interrupted: false,
    created_at: new Date().toISOString(),
  });
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function render() {
  await act(async () => {
    root.render(<CompanionHome />);
    await settle();
  });
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
    await settle();
  });
}
async function enter(text: string) {
  await act(async () => {
    const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(text: string) {
  await enter(text);
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  });
}
async function history() {
  await click('[aria-label="打开菜单"]');
  const button = [...host.querySelectorAll("nav button")].find(
    (node) => node.textContent === "对话记录",
  )!;
  await act(async () => {
    (button as HTMLButtonElement).click();
    await settle();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("TextEncoder", TextEncoder);
  vi.stubGlobal("TextDecoder", TextDecoder);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  requests = [];
  messages = [];
  actions = [];
  confirmFailure = false;
  handleText = (body) => {
    addMessage("user", body.text, body.id);
    actions = [{ ...proposal }];
    addMessage("assistant", "先确认这个目标，再一起安排下一步。");
    return stream([
      { type: "delta", text: "先确认这个目标，" },
      { type: "delta", text: "再一起安排下一步。" },
      { type: "done", messages: [...messages], actions: [...actions] },
    ]);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if (body.operation === "bootstrap")
        return Response.json({
          ok: true,
          conversationId,
          messages,
          actions,
          preferences: { value: defaultPreferences, revision: 0 },
          textConfigured: true,
          voiceConfigured: false,
        });
      if (body.operation === "text") return handleText(body, init.signal);
      if (body.operation === "confirm") {
        if (confirmFailure)
          return Response.json(
            { ok: false, code: "version_conflict" },
            { status: 409 },
          );
        actions = [];
        addMessage("assistant", "已保存。我们可以继续下一步。");
        return Response.json({
          ok: true,
          receipt: { id: actionId, status: "confirmed" },
        });
      }
      if (body.operation === "history")
        return Response.json({ ok: true, messages: [] });
      throw new Error(`Unexpected operation ${body.operation}`);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await settle();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("Shayna full-screen home with the real text runtime", () => {
  it("keeps the stage and composer permanent and places navigation and settings inside the menu", async () => {
    await render();
    expect(host.querySelector('[data-testid="avatar-stage"]')).not.toBeNull();
    expect(host.querySelector("textarea")?.getAttribute("id")).toBe(
      "companion-input",
    );
    expect(host.querySelector("nav")).toBeNull();
    expect(host.querySelector('[aria-label="待确认提案"]')).toBeNull();
    expect(host.querySelector('[role="log"]')).toBeNull();
    // Status remains available to assistive technology but does not occupy
    // the visible composer requested to stay visually quiet.
    expect(host.querySelector('[role="status"]')?.classList.contains("companion-sr-only")).toBe(true);
    expect(host.querySelector('[aria-label="开启连续语音"]')).not.toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(3);
    expect(host.querySelector("header,.topbar")).toBeNull();
    expect(
      host.querySelector("h1")?.classList.contains("companion-input-label"),
    ).toBe(true);
    expect(
      host.querySelector('label[for="companion-input"]')?.textContent,
    ).toBe("和 Shayna 对话");
    await click('[aria-label="打开菜单"]');
    expect(
      host.querySelector('nav a[href="/settings/companion"]')?.textContent,
    ).toBe("管家设置");
    expect(host.querySelector('nav a[href="/paths"]')).not.toBeNull();
    expect(requests.map((request) => request.operation)).toEqual(["bootstrap"]);
  });
  it("streams a reply and proposal without saving, then confirms explicitly and restores the receipt in history", async () => {
    await render();
    await submit("帮我制定一个摄影目标");
    expect(host.querySelector('[role="log"]')?.textContent).toBe(
      "先确认这个目标，再一起安排下一步。",
    );
    expect(
      host.querySelector('[aria-label="待确认提案"]')?.textContent,
    ).toContain("完成三组摄影练习");
    expect(
      requests.filter((request) => request.operation === "confirm"),
    ).toHaveLength(0);
    const confirm = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "确认保存",
    )!;
    await act(async () => {
      confirm.click();
      await settle();
    });
    expect(
      requests.filter((request) => request.operation === "confirm"),
    ).toEqual([{ operation: "confirm", id: actionId }]);
    expect(host.querySelector('[aria-label="待确认提案"]')).toBeNull();
    expect(host.querySelector('[role="log"]')?.textContent).toContain("已保存");
    await history();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "已保存。我们可以继续下一步。",
    );
  });
  it("keeps the proposal and usable input after a failed formal confirmation without showing success", async () => {
    confirmFailure = true;
    await render();
    await submit("制定摄影目标");
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "确认保存")!
        .click();
      await settle();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "内容已经变化",
    );
    expect(host.querySelector('[role="log"]')?.textContent ?? "").not.toContain(
      "已保存",
    );
    expect(host.querySelector('[aria-label="待确认提案"]')).not.toBeNull();
    await enter("重新检查目标");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(
      false,
    );
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="发送文字"]')!
        .disabled,
    ).toBe(false);
    expect(messages.some((message) => message.text.includes("已保存"))).toBe(
      false,
    );
  });
  it("reports a text API failure while leaving typing and retry available", async () => {
    handleText = () =>
      Response.json(
        { ok: false, code: "provider_unavailable" },
        { status: 503 },
      );
    await render();
    await submit("说说下一步");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "回复暂时中断",
    );
    expect(host.querySelector('[role="log"]')).toBeNull();
    await enter("重试这一句");
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="发送文字"]')!
        .disabled,
    ).toBe(false);
  });
  it("interrupts an old stream and lets a new turn reply without restoring stale subtitles", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    handleText = (_body, signal) =>
      new Response(
        new ReadableStream({
          start(value) {
            controller = value;
            signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"delta","text":"旧回复片段"}\n\n',
              ),
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    await render();
    await submit("第一轮");
    expect(host.querySelector('[role="log"]')?.textContent).toBe("旧回复片段");
    await click('[aria-label="打断回复"]');
    expect(host.querySelector('[role="log"]')).toBeNull();
    handleText = () =>
      stream([
        { type: "delta", text: "新一轮继续下一步。" },
        { type: "done", messages: [], actions: [] },
      ]);
    await submit("第二轮");
    expect(host.querySelector('[role="log"]')?.textContent).toBe(
      "新一轮继续下一步。",
    );
    expect(host.textContent).not.toContain("旧回复片段");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("renders stored HTML and script strings as inert history text", async () => {
    const untrusted =
      '<img src=x onerror="window.compromised=true"><script>window.compromised=true</script>';
    addMessage("assistant", untrusted);
    await render();
    await history();
    expect(host.querySelector(".companion-message-list p")?.textContent).toBe(
      untrusted,
    );
    expect(host.querySelector(".companion-message-list script")).toBeNull();
    expect(host.querySelector(".companion-message-list img")).toBeNull();
    expect(
      (window as Window & { compromised?: boolean }).compromised,
    ).toBeUndefined();
  });
});
