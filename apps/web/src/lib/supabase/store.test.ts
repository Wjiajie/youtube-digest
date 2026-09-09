import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createSupabaseBlueprintStore } from "./store";
import { createBlueprintApplication } from "@blueprint/domain";

const ownerId = "b5000000-0000-4000-8000-000000000001";
const blueprintId = "b5000000-0000-4000-8000-000000000002";
const goalId = "b5000000-0000-4000-8000-000000000003";
const committed = {
  schemaVersion: 2, id: blueprintId, version: 1, title: "正式路径",
  goals: [{ id: goalId, title: "新目标", position: 0, stages: [] }],
};

it("never combines an old revision with goals committed during a Blueprint read", async () => {
  const client = createClient("https://database.example.test", "fixture-publishable", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (value, init) => {
      const req = new Request(value, init);
      const path = new URL(req.url).pathname;
      // External PostgREST fixture: a confirmation commits after the root read.
      if (path === "/rest/v1/blueprints") return Response.json([{ id: blueprintId, version: 0, title: "旧空蓝图" }]);
      if (path === "/rest/v1/goals") return Response.json([{ id: goalId, title: "新目标", position: 0 }]);
      if (path === "/rest/v1/stages") return Response.json([]);
      if (path === "/rest/v1/rpc/read_blueprint_snapshot_v2") {
        expect(await req.json()).toEqual({ p_owner_id: ownerId });
        return Response.json(committed);
      }
      throw new Error("Unexpected external request");
    } },
  });
  expect(await createSupabaseBlueprintStore(client).getMainBlueprint(ownerId)).toEqual(committed);
});

it("returns no Blueprint for an absent or unauthorized owner", async () => {
  const client = createClient("https://database.example.test", "fixture-publishable", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => Response.json(null) },
  });
  expect(await createSupabaseBlueprintStore(client).getMainBlueprint(ownerId)).toBeNull();
});

it("rejects an old write format before a proposal can lose node planning information", async () => {
  const draft = { ...committed, schemaVersion: 1 as const };
  const client = createClient("https://database.example.test", "fixture-publishable", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (value, init) => {
      const request = new Request(value, init);
      if (new URL(request.url).pathname.includes("/rpc/")) return Response.json({ ...committed, schemaVersion: 2 });
      if (request.method === "POST") return Response.json(await request.json());
      return Response.json(null);
    } },
  });
  const application = createBlueprintApplication({ store: createSupabaseBlueprintStore(client), newId: () => crypto.randomUUID(), now: () => new Date() });
  expect(await application.createProposal({ userId: ownerId, client: "web" }, {
    draft, baseVersion: 1, clientMutationId: crypto.randomUUID(),
  })).toMatchObject({ ok: false, code: "invalid" });
});

it.each(["BLUEPRINT_SNAPSHOT_INVALID", "NODE_PLANNING_INVALID"])("reports rejected proposal content as invalid rather than a transient service outage: %s", async message => {
  const client = createClient("https://database.example.test", "fixture-publishable", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => Response.json({ code: "23514", message }, { status: 400 }) },
  });
  const application = createBlueprintApplication({ store: createSupabaseBlueprintStore(client), newId: () => crypto.randomUUID(), now: () => new Date() });
  expect(await application.applyProposal({ userId: ownerId, client: "web" }, {
    proposalId: crypto.randomUUID(), expectedVersion: 1, clientMutationId: crypto.randomUUID(),
  })).toEqual({ ok: false, code: "invalid" });
});

it.each([
  { status: 503, body: { code: "XX000", message: "provider detail" } },
  { status: 404, body: { code: "PGRST202", message: "RPC not yet migrated" } },
  { status: 200, body: { ...committed, goals: null } },
])("rejects unavailable or invalid snapshots instead of returning an empty/torn path: $status", async ({ status, body }) => {
  const client = createClient("https://database.example.test", "fixture-publishable", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => Response.json(body, { status }) },
  });
  await expect(createSupabaseBlueprintStore(client).getMainBlueprint(ownerId)).rejects.toBeDefined();
});
