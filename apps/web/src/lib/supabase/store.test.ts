import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createSupabaseBlueprintStore } from "./store";

const ownerId = "b5000000-0000-4000-8000-000000000001";
const blueprintId = "b5000000-0000-4000-8000-000000000002";
const goalId = "b5000000-0000-4000-8000-000000000003";
const committed = {
  schemaVersion: 1, id: blueprintId, version: 1, title: "正式路径",
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
      if (path === "/rest/v1/rpc/read_blueprint_snapshot") {
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
