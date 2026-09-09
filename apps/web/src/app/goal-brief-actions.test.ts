import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveGoalBriefAction, readGoalBriefAction } from "./goal-brief-actions";

const { cookies } = vi.hoisted(() => ({ cookies: [] as Array<{ name: string; value: string }> }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookies, set: () => {} }) }));
const owner = "c6000000-0000-4000-8000-000000000001";
const id = "c6000000-0000-4000-8000-000000000010";
const content = { schemaVersion: 1, outcome: "完成一场演讲", startingPoint: "只有课堂经验", targetDate: null, weeklyMinutes: 180, constraints: "", successCriteria: "获得三位听众的反馈" };
const command = { id, expectedRevision: 0, content, confirm: true, clientMutationId: "c6000000-0000-4000-8000-000000000020" };
const row = { id, owner_id: owner, blueprint_id: "c6000000-0000-4000-8000-000000000005", revision: 1,
  status: "confirmed", content, updated_at: "2026-09-10T00:00:00Z" };
let current: typeof row | null;
let replyRow: typeof row;
let authStatus: number;
let databaseCode: string | null;
beforeEach(() => {
  current = null; replyRow = structuredClone(row); authStatus = 200; databaseCode = null;
  const token = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: owner })).toString("base64url"), "fixture"].join(".");
  cookies.splice(0, cookies.length, { name: "sb-brief-auth-token", value: `base64-${Buffer.from(JSON.stringify({
    access_token: token, refresh_token: "fixture-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer", user: { id: owner },
  })).toString("base64url")}` });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://brief.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-publishable");
  vi.stubGlobal("fetch", async (value: RequestInfo | URL, init?: RequestInit) => {
    const req = value instanceof Request ? value : new Request(value, init);
    const url = new URL(req.url);
    if (url.pathname === "/auth/v1/user") return authStatus === 200 ? Response.json({ id: owner }) : Response.json({ message: "private Auth detail" }, { status: authStatus });
    if (databaseCode) return Response.json({ code: databaseCode, message: "private definition detail" }, { status: 400 });
    if (url.pathname === "/rest/v1/rpc/save_goal_brief") {
      expect(await req.json()).toEqual({ p_id: id, p_expected_revision: 0, p_content: content, p_confirm: true, p_client_mutation_id: command.clientMutationId });
      current = replyRow; return Response.json(replyRow);
    }
    if (url.pathname === "/rest/v1/goal_briefs") {
      expect(url.searchParams.get("owner_id")).toBe(`eq.${owner}`);
      expect(url.searchParams.get("id")).toBe(`eq.${id}`);
      return Response.json(current ? [current] : []);
    }
    throw new Error("Unexpected external request");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("lets the Web account confirm a definition and read the same cloud revision", async () => {
  const expected = { ok: true, value: {
    id, blueprintId: row.blueprint_id, revision: 1, status: "confirmed", content, updatedAt: row.updated_at,
  } };
  expect(await saveGoalBriefAction(owner, command)).toEqual(expected);
  expect(await readGoalBriefAction(owner, id)).toEqual(expected);
});

it("returns not-found for an absent definition, never an invented empty draft", async () => {
  expect(await readGoalBriefAction(owner, id)).toEqual({ ok: false, code: "not_found" });
});

it("rejects a stale page bound to another account without saving", async () => {
  for (const result of [await saveGoalBriefAction("other-account", command), await readGoalBriefAction("other-account", id)]) {
    expect(result).toEqual({ ok: false, code: "forbidden" });
  }
  expect(current).toBeNull();
});

it("requires a current Web session for saving and reading", async () => {
  cookies.length = 0;
  expect(await saveGoalBriefAction(owner, command)).toEqual({ ok: false, code: "unauthenticated" });
  expect(await readGoalBriefAction(owner, id)).toEqual({ ok: false, code: "unauthenticated" });
  expect(current).toBeNull();
});

it.each([429, 503])("preserves Auth provider failure %i as unavailable", async status => {
  authStatus = status;
  expect(await saveGoalBriefAction(owner, command)).toEqual({ ok: false, code: "unavailable" });
  expect(await readGoalBriefAction(owner, id)).toEqual({ ok: false, code: "unavailable" });
  expect(current).toBeNull();
});

it.each([["40001", "version_conflict"], ["P0002", "not_found"], ["42501", "forbidden"], ["22023", "invalid"], ["23514", "invalid"], ["XX000", "unavailable"]])(
  "sanitizes database %s while retaining its meaning", async (dbCode, code) => {
    databaseCode = dbCode;
    expect(await saveGoalBriefAction(owner, command)).toEqual({ ok: false, code });
    expect(current).toBeNull();
  },
);

it.each([
  { ...command, content: { ...content, successCriteria: "" } },
  { ...command, expectedRevision: -1 }, { ...command, ownerId: "forged" },
  { ...command, status: "confirmed" }, { ...command, clientMutationId: "invalid" },
])("rejects unready or forged input before transport: %j", async invalid => {
  expect(await saveGoalBriefAction(owner, invalid)).toEqual({ ok: false, code: "invalid" });
  expect(current).toBeNull();
});

it.each(["owner", "identity", "revision", "content", "status"]) ("does not accept a mismatched %s receipt as success", async changed => {
  if (changed === "owner") replyRow.owner_id = "another-owner";
  if (changed === "identity") replyRow.id = command.clientMutationId;
  if (changed === "revision") replyRow.revision = 2;
  if (changed === "content") replyRow.content.outcome = "A different goal";
  if (changed === "status") replyRow.status = "draft";
  expect(await saveGoalBriefAction(owner, command)).toEqual({ ok: false, code: "unavailable" });
});

it("does not disclose another owner's provider row", async () => {
  current = { ...row, owner_id: "another-owner" };
  expect(await readGoalBriefAction(owner, id)).toEqual({ ok: false, code: "unavailable" });
});

it("does not display another definition when a provider returns the wrong record ID", async () => {
  current = { ...row, id: command.clientMutationId };
  expect(await readGoalBriefAction(owner, id)).toEqual({ ok: false, code: "unavailable" });
});
