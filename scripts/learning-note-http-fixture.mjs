// Isolated external Auth/PostgREST HTTP fixture. Never creates real sessions/data.
import { createServer } from "node:http";
export const noteFixtureOwner = "fd510000-0000-4000-8000-000000000001";
export const noteFixtureToken = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: noteFixtureOwner, client_id: "notes-http-fixture" })).toString("base64url"), "fixture"].join(".");
export default async function setup() {
  const records = new Map(), calls = [];
  const server = createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    if (request.url === "/fixture/reset" && request.method === "POST") { records.clear(); calls.length = 0; return send(200, { ok: true }); }
    if (request.url === "/fixture/calls") return send(200, calls);
    if (request.headers.authorization !== `Bearer ${noteFixtureToken}`) return send(401, { message: "Unauthorized fixture" });
    if (request.url === "/auth/v1/user") return send(200, { id: noteFixtureOwner, is_anonymous: false });
    let raw = ""; for await (const chunk of request) raw += chunk;
    const input = raw ? JSON.parse(raw) : {};
    calls.push(request.url);
    if (request.url === "/rest/v1/rpc/record_learning_note") {
      let row = records.get(input.p_client_mutation_id);
      if (!row) {
        row = { id: "fd510000-0000-4000-8000-000000000005", owner_id: noteFixtureOwner, client_mutation_id: input.p_client_mutation_id,
          blueprint_id: "fd510000-0000-4000-8000-000000000006", blueprint_version: input.p_expected_version,
          goal_id: "fd510000-0000-4000-8000-000000000007", goal_title: "摄影", stage_id: "fd510000-0000-4000-8000-000000000008", stage_title: "曝光",
          node_id: input.p_node_id, node_title: "理解光线", node_type: "learn", resource_binding_id: input.p_resource_binding_id,
          video_id: "abcdefghijk", resource_url: "https://www.youtube.com/watch?v=abcdefghijk", note_text: input.p_note_text,
          position_seconds: input.p_position_seconds, created_at: "2026-09-10T00:00:00.000Z" };
        records.set(input.p_client_mutation_id, row);
      }
      return send(200, row);
    }
    if (request.url === "/rest/v1/rpc/read_learning_note_workspace" && input.p_owner_id === noteFixtureOwner) return send(200, {
      blueprint: { schemaVersion: 2, id: "fd510000-0000-4000-8000-000000000006", version: 2, title: "笔记路径", goals: [] }, records: [...records.values()],
    });
    return send(404, { message: "Unexpected fixture route" });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3192, "127.0.0.1", resolve); });
  return async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
}
