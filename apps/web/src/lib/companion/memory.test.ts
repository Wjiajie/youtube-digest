import { describe, expect, it, vi } from "vitest";
import type { Message } from "./contracts";
import {
  buildConversationContext,
  memoryContentSchema,
  prepareMemoryUpdate,
  type MemoryContent,
  type MemoryRecord,
  type MemorySummarizer,
} from "./memory";

const content: MemoryContent = {
  summary: "用户正在练习摄影，下一步准备比较不同光线下的照片。",
  facts: ["用户每周可投入两小时。"],
  openQuestions: ["拍摄主题尚未确定。"],
};

function message(index: number, text = `第 ${index + 1} 条原始消息`): Message {
  return {
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text,
    modality: index % 4 < 2 ? "text" : "voice",
    interrupted: false,
    created_at: new Date(Date.UTC(2026, 9, 25, 10, 0, index)).toISOString(),
  };
}

function messages(count: number) {
  return Array.from({ length: count }, (_, index) => message(index));
}

function memory(value: MemoryContent = content): MemoryRecord {
  return {
    revision: 2,
    content: value,
    throughId: message(0).id,
    throughCreatedAt: message(0).created_at,
    updatedAt: "2026-10-25T10:01:00.000Z",
  };
}

function bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function contextBytes(value: ReturnType<typeof buildConversationContext>) {
  return bytes(value.memoryText) + value.messages.reduce(
    (total, entry) => total + bytes(entry.content),
    0,
  );
}

describe("validated local conversation memory content", () => {
  it("accepts the documented maximum field sizes", () => {
    expect(memoryContentSchema.safeParse({
      summary: "摘".repeat(3000),
      facts: Array.from({ length: 20 }, () => "实".repeat(220)),
      openQuestions: Array.from({ length: 8 }, () => "问".repeat(220)),
    }).success).toBe(true);
  });

  it.each([
    { ...content, summary: "" },
    { ...content, summary: "摘".repeat(3001) },
    { ...content, facts: Array.from({ length: 21 }, () => "事实") },
    { ...content, facts: ["实".repeat(221)] },
    { ...content, openQuestions: Array.from({ length: 9 }, () => "问题") },
    { ...content, openQuestions: ["问".repeat(221)] },
  ])("rejects invalid memory rather than silently accepting it: %#", (invalid) => {
    expect(memoryContentSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("incremental memory compression boundaries", () => {
  it("does not summarize when fewer than twelve old short messages are eligible", async () => {
    const pending = messages(17);
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    expect(await prepareMemoryUpdate(pending, pending, null, summarize)).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("summarizes twelve eligible messages while retaining the latest six verbatim", async () => {
    const pending = messages(18);
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    const result = await prepareMemoryUpdate(pending, pending, null, summarize);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledWith({
      previous: null,
      messages: pending.slice(0, 12),
    });
    expect(result).toEqual({
      content,
      throughId: pending[11].id,
      throughCreatedAt: pending[11].created_at,
    });
  });

  it("keeps the question with an answer that would otherwise begin the retained window", async () => {
    const pending = messages(19);
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    const result = await prepareMemoryUpdate(pending, pending, null, summarize);
    expect(summarize.mock.calls[0][0].messages).toEqual(pending.slice(0, 12));
    expect(result?.throughId).toBe(pending[11].id);
    expect(pending.slice(12)[0].role).toBe("user");
    expect(pending.slice(12)).toHaveLength(7);
  });

  it("triggers on UTF-8 byte pressure even with fewer than twelve old messages", async () => {
    const pending = messages(8);
    pending[0].text = "旧".repeat(3000);
    pending[1].text = "事".repeat(3000);
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    const result = await prepareMemoryUpdate(pending, pending, null, summarize);
    expect(summarize).toHaveBeenCalledWith({ previous: null, messages: pending.slice(0, 2) });
    expect(result?.throughId).toBe(pending[1].id);
  });

  it("passes the previous memory forward and caps each new batch by UTF-8 bytes", async () => {
    const pending = messages(18);
    for (const entry of pending.slice(0, 12)) entry.text = "旧".repeat(1500);
    const previous = memory();
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    const result = await prepareMemoryUpdate(pending, pending, previous, summarize);
    const input = summarize.mock.calls[0][0];
    expect(input.previous).toEqual(previous.content);
    expect(input.messages.length).toBeGreaterThan(0);
    expect(input.messages.length).toBeLessThan(12);
    expect(input.messages.reduce((total, entry) => total + bytes(entry.text), 0)).toBeLessThanOrEqual(24000);
    expect(input.messages).toEqual(pending.slice(0, input.messages.length));
    expect(result?.throughId).toBe(input.messages.at(-1)!.id);
    expect(result?.throughCreatedAt).toBe(input.messages.at(-1)!.created_at);
  });

  it("does not include interrupted assistant output in the summary or mutate original history", async () => {
    const pending = messages(22);
    pending[3].interrupted = true;
    pending[7].interrupted = true;
    const original = structuredClone(pending);
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    const result = await prepareMemoryUpdate(pending, pending, null, summarize);
    expect(result).not.toBeNull();
    const input = summarize.mock.calls[0][0].messages;
    expect(input.some((entry) => entry.interrupted)).toBe(false);
    expect(input.some((entry) => entry.id === pending[3].id || entry.id === pending[7].id)).toBe(false);
    expect(pending).toEqual(original);
  });

  it("compresses every fragment of an oversized old message before returning its original cursor", async () => {
    const pending = messages(8);
    pending[0].text = '旧😀"\\\n'.repeat(2500);
    const original = structuredClone(pending);
    const previous = memory();
    const outputs: MemoryContent[] = [];
    const summarize = vi.fn<MemorySummarizer>(async () => {
      const output = { ...content, summary: `已合并 ${outputs.length + 1} 个片段。` };
      outputs.push(output);
      return output;
    });
    const result = await prepareMemoryUpdate(pending, pending, previous, summarize);
    expect(summarize.mock.calls.length).toBeGreaterThan(1);
    expect(summarize.mock.calls[0][0].previous).toEqual(previous.content);
    for (const [index, [input]] of summarize.mock.calls.entries()) {
      expect(bytes(JSON.stringify(input.messages))).toBeLessThanOrEqual(24000);
      expect(input.messages).toHaveLength(1);
      expect(input.messages[0].id).toBe(pending[0].id);
      if (index > 0) expect(input.previous).toEqual(outputs[index - 1]);
    }
    expect(summarize.mock.calls.flatMap(([input]) => input.messages.map((entry) => entry.text)).join("")).toBe(pending[0].text);
    expect(result).toEqual({
      content: outputs.at(-1),
      throughId: pending[0].id,
      throughCreatedAt: pending[0].created_at,
    });
    expect(pending).toEqual(original);
  });

  it("does not advance an oversized message's cursor when a later fragment fails", async () => {
    const pending = messages(8);
    pending[0].text = "旧😀".repeat(4000);
    const previous = memory();
    const original = structuredClone({ pending, previous });
    const summarize = vi.fn<MemorySummarizer>()
      .mockResolvedValueOnce(content)
      .mockRejectedValueOnce(new Error("second fragment unavailable"));
    expect(await prepareMemoryUpdate(pending, pending, previous, summarize)).toBeNull();
    expect(summarize).toHaveBeenCalledTimes(2);
    expect({ pending, previous }).toEqual(original);
  });

  it("does not call the summarizer when there are no new eligible messages", async () => {
    const recent = messages(6);
    const summarize = vi.fn<MemorySummarizer>().mockResolvedValue(content);
    expect(await prepareMemoryUpdate([], recent, memory(), summarize)).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it.each([
    async () => { throw new Error("summary unavailable"); },
    async () => ({ ...content, summary: "" }),
    async () => ({ ...content, summary: "摘".repeat(3001) }),
    async () => ({ ...content, facts: Array.from({ length: 21 }, () => "事实") }),
  ])("leaves the old memory and cursor untouched when summarization fails: %#", async (summarizer) => {
    const pending = messages(18);
    const previous = memory();
    const original = structuredClone(previous);
    const result = await prepareMemoryUpdate(pending, pending, previous, summarizer);
    expect(result).toBeNull();
    expect(previous).toEqual(original);
    expect(pending).toEqual(messages(18));
  });
});

describe("bounded context for continued text and voice conversations", () => {
  it("includes the stored summary and a single copy of the newest user message", () => {
    const recent = messages(7);
    recent[6].text = "我今天只有二十分钟，下一步做什么？";
    const result = buildConversationContext(recent, memory());
    expect(result.memoryText).toContain(content.summary);
    expect(result.memoryText).toContain(content.facts[0]);
    expect(result.memoryText).toContain(content.openQuestions[0]);
    expect(result.messages.filter((entry) => entry.role === "user" && entry.content === recent[6].text)).toHaveLength(1);
    expect(result.messages.at(-1)).toEqual({ role: "user", content: recent[6].text });
    expect(contextBytes(result)).toBeLessThanOrEqual(32000);
  });

  it("labels compressed history as data without authority to instruct or confirm", () => {
    const result = buildConversationContext(messages(3), memory());
    expect(result.memoryText).toMatch(/历史/);
    expect(result.memoryText).toMatch(/指令/);
    expect(result.memoryText).toMatch(/确认/);
    expect(result.memoryText).toMatch(/不可|不能|不应|不是|不代表|不执行/);
  });

  it("continues with recent messages when no memory is available and filters interrupted output", () => {
    const recent = messages(7);
    recent[5].text = "只说出了一半的回答";
    recent[5].interrupted = true;
    const result = buildConversationContext(recent, null);
    expect(result.memoryText).toBe("");
    expect(result.messages.some((entry) => entry.content === recent[5].text)).toBe(false);
    expect(result.messages.at(-1)).toEqual({ role: "user", content: recent[6].text });
  });

  it("keeps an eight-thousand-character Chinese latest input intact within the default byte budget", () => {
    const recent = messages(25);
    for (const entry of recent.slice(0, -1)) entry.text = "历史对话".repeat(1000);
    recent[24].text = "问".repeat(8000);
    const result = buildConversationContext(recent, memory());
    expect(contextBytes(result)).toBeLessThanOrEqual(32000);
    expect(result.messages.filter((entry) => entry.content === recent[24].text)).toHaveLength(1);
    expect(result.messages.at(-1)).toEqual({ role: "user", content: recent[24].text });
  });

  it("counts memory labels and multibyte characters toward an explicitly smaller hard budget", () => {
    const recent = messages(21);
    for (const entry of recent) entry.text = "摄影与光线".repeat(100);
    recent[20].text = "今天先拍三张照片。";
    const result = buildConversationContext(recent, memory(), 2000);
    expect(contextBytes(result)).toBeLessThanOrEqual(2000);
    expect(result.messages.at(-1)).toEqual({ role: "user", content: recent[20].text });
  });

  it("bounds a maximal valid memory block including labels to six thousand UTF-8 bytes", () => {
    const maximal: MemoryContent = {
      summary: "摘".repeat(3000),
      facts: Array.from({ length: 20 }, () => "实".repeat(220)),
      openQuestions: Array.from({ length: 8 }, () => "问".repeat(220)),
    };
    const result = buildConversationContext(messages(3), memory(maximal));
    expect(bytes(result.memoryText)).toBeLessThanOrEqual(6000);
    expect(result.memoryText).toMatch(/历史/);
    expect(result.memoryText).toMatch(/确认/);
    expect(contextBytes(result)).toBeLessThanOrEqual(32000);
  });
});
