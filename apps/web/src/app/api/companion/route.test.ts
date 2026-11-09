import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeSignature, sealTicket } from "@/lib/companion/ticket";
import { defaultPreferences } from "@/lib/companion/contracts";
import { POST } from "./route";

const fixture = vi.hoisted(() => ({
  resolve: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  createClient: vi.fn(),
  open: vi.fn(),
  messages: [] as any[],
  actions: [] as any[],
  append: vi.fn(),
  read: vi.fn(),
  stream: vi.fn(),
  queries: [] as any[],
}));
const owner = "8661d905-e381-4d5b-8a78-bbb02c96d265",
  conversation = "90e9393e-cee5-4b76-aedd-81191ef37d50";
const userMessage = "48699a39-f91d-4f6f-9f10-d90dc5da8b10",
  action = "bdf37f6b-6fed-4400-abf7-0075f416f790";
const secret = "cf".repeat(32),
  origin = "https://blueprint.test";
const client = {
  rpc: fixture.rpc,
  auth: { getUser: fixture.getUser, getSession: fixture.getSession },
  from: (table: string) => {
    const query: any = {
      table,
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      update: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: { id: userMessage },
        error: null,
      })),
      then: (done: any) =>
        Promise.resolve({ data: null, error: null }).then(done),
    };
    fixture.queries.push(query);
    return query;
  },
};
vi.mock("@/lib/supabase/request", () => ({
  resolveRequestActor: fixture.resolve,
}));
vi.mock("@/lib/env", () => ({
  publicSupabaseConfig: () => ({
    url: "https://database.example.test",
    publishableKey: "test-public-key",
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: fixture.createClient,
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  streamText: fixture.stream,
}));
vi.mock("@/lib/companion/store", () => ({
  checked: (result: any) => {
    if (result.error) throw new Error(result.error.code);
    return result.data;
  },
  openConversation: fixture.open,
  appendMessage: fixture.append,
  readMessages: fixture.read,
  readActions: async () => [...fixture.actions],
  preferences: async () => ({ value: defaultPreferences, revision: 0 }),
  savePreferences: vi.fn(),
}));

function cookieIdentity() {
  fixture.resolve.mockResolvedValue({
    ok: true,
    value: { actor: { userId: owner, client: "web" }, client },
  });
}
function pendingAction() {
  fixture.actions = [
    {
      id: action,
      kind: "goal",
      status: "pending",
      payload: {},
      source_message_id: userMessage,
    },
  ];
}
function request(input: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/companion`, {
    method: "POST",
    headers: {
      Host: "blueprint.test",
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: "session=test-cookie",
      ...headers,
    },
    body: JSON.stringify(input),
  });
}
function signed(event: unknown, patch: Record<string, unknown> = {}) {
  const now = Date.now(),
    ticket = sealTicket(
      {
        ownerId: owner,
        conversationId: conversation,
        accessToken: "delegated-user-token",
        origin,
        nonce: "c81db89c-58ec-4e23-8a90-5ec738ff2442",
        issuedAt: now,
        expiresAt: now + 60_000,
        ...patch,
      },
      secret,
    );
  const body = { operation: "bridge", ticket, event };
  return request(body, {
    "x-companion-signature": bridgeSignature(JSON.stringify(body), secret),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.messages = [];
  fixture.actions = [];
  fixture.queries = [];
  fixture.read.mockImplementation(async () => [...fixture.messages]);
  fixture.resolve.mockResolvedValue({ ok: false, code: "unauthenticated" });
  fixture.open.mockResolvedValue(conversation);
  fixture.createClient.mockReturnValue(client);
  fixture.rpc.mockResolvedValue({ data: { saved: true }, error: null });
  fixture.getUser.mockResolvedValue({
    data: { user: { id: owner } },
    error: null,
  });
  fixture.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: "cookie-user-token",
        expires_at: Date.now() / 1000 + 3600,
      },
    },
  });
  fixture.append.mockImplementation(
    async (_ctx, id, role, text, modality, interrupted = false) => {
      if (fixture.messages.some((message) => message.id === id))
        throw new Error("23505");
      fixture.messages.push({
        id,
        role,
        text,
        modality,
        interrupted,
        created_at: new Date().toISOString(),
      });
    },
  );
  fixture.stream.mockImplementation(() => ({
    fullStream: (async function* () {
      yield { type: "text-delta", text: "我们先明确一个小目标。" };
    })(),
  }));
  vi.stubEnv("BLUEPRINT_COMPANION_ENABLED", "true");
  vi.stubEnv("DEEPSEEK_API_KEY", "test-no-model-request");
  vi.stubEnv("COMPANION_GATEWAY_SECRET", secret);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected external request in isolated route test");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("model-specific avatar tools", () => {
  const capabilities = {
    revision: "8cb93a31-bf3f-4444-bb24-7cb53831f101",
    modelId: "model-a",
    controls: [{ kind: "expression", id: "smile", label: "微笑" }],
  };
  const cue = { revision: capabilities.revision, kind: "expression", id: "smile", value: 0.8 };
  it("only exposes the current avatar tool when a usable model is available", async () => {
    const empty = await (await POST(signed({ kind: "initialize", capabilities: null }))).json();
    expect(empty.tools.map((t: any) => t.name)).not.toContain("avatar_cue");
    expect(empty.tools.map((t: any) => t.name)).not.toContain("avatar_control");
    expect(empty.tools.map((t: any) => t.name)).toContain("read_goals");
    const loaded = await (await POST(signed({ kind: "initialize", capabilities }))).json();
    expect(loaded.tools.map((t: any) => t.name)).toContain("avatar_control");
    expect(loaded.instructions).toContain("avatar_control");
    expect(JSON.stringify(loaded.tools)).toContain("smile");
    const modelB = { ...capabilities, revision: "8cb93a31-bf3f-4444-bb24-7cb53831f102", modelId: "model-b", controls: [{ kind: "motion", id: "wave", label: "挥手" }] };
    const switched = await (await POST(signed({ kind: "avatar_capabilities", capabilities: modelB }))).json();
    expect(JSON.stringify(switched.tools)).toContain("wave");
    expect(JSON.stringify(switched.tools)).not.toContain("smile");
    const changed = await (await POST(signed({ kind: "avatar_capabilities", capabilities: null }))).json();
    expect(changed.tools.map((t: any) => t.name)).not.toContain("avatar_control");
    expect(changed.tools.map((t: any) => t.name)).toContain("read_goals");
  });
  it("checks voice control parameters against the supplied capability directory", async () => {
    const execute = async (args: unknown, current: unknown = capabilities) =>
      (await POST(signed({ kind: "tool", messageId: userMessage, name: "avatar_control", arguments: args, callId: "voice:1", capabilities: current }))).json();
    expect(await execute(cue)).toMatchObject({ result: { ok: true }, cue });
    for (const args of [{ ...cue, id: "other" }, { ...cue, revision: "8cb93a31-bf3f-4444-bb24-7cb53831f102" }, { ...cue, value: 2 }]) {
      const result = await execute(args);
      expect(result.result.ok).toBe(false);
      expect(result.cue).toBeUndefined();
    }
    expect((await execute(cue, null)).result.ok).toBe(false);
    const legacy = await (await POST(signed({ kind: "tool", messageId: userMessage, name: "avatar_cue", arguments: { kind: "motion", id: "wave" }, callId: "voice:2", capabilities }))).json();
    expect(legacy.result.ok).toBe(false);
    expect(legacy.cue).toBeUndefined();
  });
  it("exposes and validates the active model tool in text streaming", async () => {
    cookieIdentity();
    let valid: any, invalid: any;
    fixture.stream.mockImplementation(({ tools }: any) => ({ fullStream: (async function* () {
      valid = await tools.avatar_control.execute(cue, { toolCallId: "v" });
      invalid = await tools.avatar_control.execute({ ...cue, id: "unknown" }, { toolCallId: "i" });
      yield { type: "text-delta", text: "好。" };
    })() }));
    const response = await POST(request({ operation: "text", id: userMessage, text: "笑一下", capabilities }));
    const stream = await response.text();
    expect(valid.ok).toBe(true);
    expect(invalid.ok).toBe(false);
    expect(stream.match(/"type":"cue"/g)).toHaveLength(1);
    expect(stream).toContain(JSON.stringify(cue));
    const tools = fixture.stream.mock.calls[0][0].tools;
    expect(tools.avatar_control).toBeDefined();
    expect(tools.avatar_cue).toBeUndefined();
  });
  it("does not expose avatar tools in text without a model", async () => {
    cookieIdentity();
    const response = await POST(request({ operation: "text", id: userMessage, text: "你好", capabilities: null }));
    await response.text();
    const tools = fixture.stream.mock.calls[0][0].tools;
    expect(tools.avatar_cue).toBeUndefined();
    expect(tools.avatar_control).toBeUndefined();
  });
});

describe("browser cookie and Origin boundary", () => {
  it.each([
    { Origin: "https://attacker.test" },
    { Authorization: "Bearer user-token" },
  ] as Record<string, string>[])(
    "rejects cross-origin or bearer requests before cookie identity resolution",
    async (headers) => {
      cookieIdentity();
      const response = await POST(request({ operation: "bootstrap" }, headers));
      expect(response.status).toBe(403);
      expect(fixture.resolve).not.toHaveBeenCalled();
      expect(fixture.open).not.toHaveBeenCalled();
    },
  );
  it("requires the cookie resolver to return an authenticated Web user", async () => {
    const response = await POST(request({ operation: "bootstrap" }));
    expect(response.status).toBe(401);
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.stream).not.toHaveBeenCalled();
    fixture.resolve.mockResolvedValue({
      ok: true,
      value: { actor: { userId: owner, client: "extension" }, client },
    });
    expect((await POST(request({ operation: "bootstrap" }))).status).toBe(403);
  });
  it("returns private account state after cookie authentication without exposing credentials", async () => {
    cookieIdentity();
    const response = await POST(request({ operation: "bootstrap" })),
      body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.parse(body).conversationId).toBe(conversation);
    expect(body).not.toContain("test-no-model-request");
    expect(body).not.toContain(secret);
  });
});

describe("authenticated gateway delegation", () => {
  it("requires an independent HMAC even when a browser cookie identity is available", async () => {
    cookieIdentity();
    const response = await POST(
      request({
        operation: "bridge",
        ticket: "untrusted",
        event: { kind: "initialize" },
      }),
    );
    expect(response.status).toBe(403);
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(fixture.getUser).not.toHaveBeenCalled();
  });
  it("rejects a signed event when the delegated token belongs to another account", async () => {
    fixture.getUser.mockResolvedValue({
      data: { user: { id: "df690bda-9ed0-4a74-b6d8-9d503a57ce47" } },
      error: null,
    });
    const response = await POST(signed({ kind: "initialize" }));
    expect(response.status).toBe(401);
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("rejects tickets for a deleted or replaced conversation", async () => {
    const response = await POST(
      signed(
        { kind: "initialize" },
        { conversationId: "65a301fb-9d99-4051-af80-ea4406c3afef" },
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: "stale_session" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("does not allow an expired signed ticket to execute a business operation", async () => {
    const response = await POST(
      signed(
        { kind: "user", id: userMessage, text: "确认保存" },
        { issuedAt: Date.now() - 120_000, expiresAt: Date.now() - 1 },
      ),
    );
    expect(response.ok).toBe(false);
    expect(fixture.open).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("uses only the delegated user's token and never resolves a browser cookie for bridge requests", async () => {
    const response = await POST(signed({ kind: "initialize" }));
    expect(response.status).toBe(200);
    expect(fixture.getUser).toHaveBeenCalledWith("delegated-user-token");
    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(
      fixture.createClient.mock.calls[0][2].global.headers.Authorization,
    ).toBe("Bearer delegated-user-token");
  });
});

describe("confirmation and model tool isolation", () => {
  it("does not treat a model-generated assistant acknowledgement as user confirmation", async () => {
    pendingAction();
    const response = await POST(
      signed({
        kind: "assistant",
        id: userMessage,
        text: "确认保存",
        actionId: action,
      }),
    );
    expect(response.status).toBe(200);
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.messages[0].role).toBe("assistant");
  });
  it.each(["好", "不要确认保存", "他说确认保存", "确认保存吗？"])(
    "does not confirm an ambiguous or quoted user transcript: %s",
    async (text) => {
      pendingAction();
      const response = await POST(
        signed({ kind: "user", id: userMessage, text }),
      );
      expect(response.status).toBe(200);
      expect(fixture.rpc).not.toHaveBeenCalled();
    },
  );
  it("binds explicit voice confirmation to the persisted user message and selected proposal", async () => {
    pendingAction();
    const response = await POST(
      signed({
        kind: "user",
        id: userMessage,
        text: "确认保存！",
        actionId: action,
      }),
    );
    expect(response.status).toBe(200);
    expect(fixture.rpc).toHaveBeenCalledWith("confirm_companion_action", {
      p_id: action,
      p_mode: "voice",
      p_message_id: userMessage,
    });
    expect(fixture.messages[0]).toMatchObject({
      id: userMessage,
      role: "user",
      text: "确认保存！",
    });
    expect(fixture.messages[1].text).toContain("已保存");
  });
  it("never persists a success acknowledgement when the formal confirmation RPC fails", async () => {
    pendingAction();
    fixture.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(
      signed({
        kind: "user",
        id: userMessage,
        text: "确认保存",
        actionId: action,
      }),
    );
    expect(response.status).toBe(409);
    expect(
      fixture.messages.filter((message) => message.role === "assistant"),
    ).toHaveLength(0);
  });
  it.each(["click", "text", "voice"])(
    "preserves the committed %s receipt when writing the assistant history fails",
    async (mode) => {
      cookieIdentity();
      pendingAction();
      const savedAppend = fixture.append.getMockImplementation()!;
      fixture.append.mockImplementation(async (...args) => {
        if (args[2] === "assistant")
          throw new Error("history_write_unavailable");
        return savedAppend(...args);
      });
      const response = await POST(
        mode === "click"
          ? request({ operation: "confirm", id: action })
          : mode === "text"
            ? request({
                operation: "text",
                id: userMessage,
                text: "确认保存",
                actionId: action,
              })
            : signed({
                kind: "user",
                id: userMessage,
                text: "确认保存",
                actionId: action,
              }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: true,
        receipt: { saved: true },
        historySaved: false,
      });
      expect(body.message).toContain("已保存");
      expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith(
        "confirm_companion_action",
        {
          p_id: action,
          p_mode: mode,
          p_message_id: mode === "click" ? null : userMessage,
        },
      );
      expect(
        fixture.messages.filter((message) => message.role === "assistant"),
      ).toHaveLength(0);
      expect(fixture.stream).not.toHaveBeenCalled();
    },
  );
  it("preserves a committed click receipt when reading conversation context for its acknowledgement fails", async () => {
    cookieIdentity();
    fixture.read.mockRejectedValueOnce(new Error("history_read_unavailable"));
    const response = await POST(request({ operation: "confirm", id: action }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      receipt: { saved: true },
      message: "已保存。我们可以继续下一步。",
      historySaved: true,
    });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith(
      "confirm_companion_action",
      {
        p_id: action,
        p_mode: "click",
        p_message_id: null,
      },
    );
    expect(fixture.messages).toHaveLength(1);
    expect(fixture.messages[0]).toMatchObject({
      role: "assistant",
      text: "已保存。我们可以继续下一步。",
    });
  });
  it.each([
    { modality: "voice", actionId: undefined },
    { modality: "voice", actionId: "9ac41a50-b32b-4c31-83ef-3c14d845a280" },
    { modality: "text", actionId: undefined },
    { modality: "text", actionId: "9ac41a50-b32b-4c31-83ef-3c14d845a280" },
  ])(
    "does not confirm $modality when the displayed proposal ID is missing or different",
    async ({ modality, actionId }) => {
      pendingAction();
      cookieIdentity();
      const response = await POST(
        modality === "voice"
          ? signed({
              kind: "user",
              id: userMessage,
              text: "确认保存",
              actionId,
            })
          : request({
              operation: "text",
              id: userMessage,
              text: "确认保存",
              actionId,
            }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        code: "confirmation_required",
      });
      expect(fixture.rpc).not.toHaveBeenCalled();
      expect(fixture.stream).not.toHaveBeenCalled();
      expect(
        fixture.messages.filter((message) => message.role === "assistant"),
      ).toHaveLength(0);
    },
  );
  it("binds explicit text confirmation to the displayed proposal instead of starting the model", async () => {
    pendingAction();
    cookieIdentity();
    const response = await POST(
      request({
        operation: "text",
        id: userMessage,
        text: "确认保存",
        actionId: action,
      }),
    );
    expect(response.status).toBe(200);
    expect(fixture.rpc).toHaveBeenCalledWith("confirm_companion_action", {
      p_id: action,
      p_mode: "text",
      p_message_id: userMessage,
    });
    expect(fixture.stream).not.toHaveBeenCalled();
  });
  it("rejects a model tool that attempts to invoke formal confirmation directly", async () => {
    const response = await POST(
      signed({
        kind: "tool",
        messageId: userMessage,
        name: "confirm_companion_action",
        arguments: { p_id: action },
        callId: "model-attempt",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { ok: false, code: "unknown_tool" },
    });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("exposes preparation tools to the text model while withholding apply and confirmation tools", async () => {
    cookieIdentity();
    const response = await POST(
      request({ operation: "text", id: userMessage, text: "帮我制定目标" }),
    );
    await response.text();
    expect(fixture.stream).toHaveBeenCalledOnce();
    const tools = fixture.stream.mock.calls[0][0].tools;
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "read_goals",
        "draft_goal",
        "prepare_progress",
        "generate_plan",
      ]),
    );
    expect(
      Object.keys(tools).some((name) =>
        /confirm|apply|save_goal_brief|record_progress_evidence/.test(name),
      ),
    ).toBe(false);
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual([
      "read_companion_context",
    ]);
  });
  it("fences a repeated text message ID before it can start a second model request", async () => {
    cookieIdentity();
    const input = { operation: "text", id: userMessage, text: "帮我制定目标" };
    await (await POST(request(input))).text();
    const duplicate = await POST(request(input));
    expect(duplicate.status).toBe(409);
    expect(fixture.stream).toHaveBeenCalledOnce();
  });
});
