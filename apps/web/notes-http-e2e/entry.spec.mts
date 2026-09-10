import { test, expect } from "@playwright/test";
import { request as httpRequest } from "node:http";
import { noteFixtureToken } from "../../../scripts/learning-note-http-fixture.mjs";

const origin = "http://127.0.0.1:3193", fixture = "http://127.0.0.1:3192";
const headers = { authorization: `Bearer ${noteFixtureToken}`, "content-type": "application/json" };
const command = { nodeId: "fd510000-0000-4000-8000-000000000002", resourceBindingId: "fd510000-0000-4000-8000-000000000003",
  clientMutationId: "fd510000-0000-4000-8000-000000000004", expectedVersion: 2, text: "  原样保存的一条笔记。\n", positionSeconds: 125 };
test.beforeEach(async ({ request }) => { expect((await request.post(`${fixture}/fixture/reset`)).ok()).toBe(true); });
test("production note HTTP preserves private source through the external Auth and PostgREST boundary", async ({ request }) => {
  const saved = await request.post(`${origin}/api/v1/learning-notes`, { headers, data: command });
  expect(saved.status()).toBe(200); expect(saved.headers()["cache-control"]).toBe("private, no-store");
  const note = await saved.json();
  expect(note).toMatchObject({ text: command.text, positionSeconds: 125, clientMutationId: command.clientMutationId,
    context: { nodeId: command.nodeId, blueprintVersion: 2 }, resource: { bindingId: command.resourceBindingId, videoId: "abcdefghijk" } });
  const read = await request.get(`${origin}/api/v1/learning-notes`, { headers });
  expect(read.status()).toBe(200); expect((await read.json()).records).toEqual([note]);
  expect(await (await request.get(`${fixture}/fixture/calls`)).json()).toEqual(["/rest/v1/rpc/record_learning_note", "/rest/v1/rpc/read_learning_note_workspace"]);
});
test("production note HTTP rejects a stalled body within its own deadline without a database request", async ({ request }) => {
  const result = await new Promise<{ status: number; body: string; cache: string | undefined }>((resolve, reject) => {
    const pending = httpRequest(`${origin}/api/v1/learning-notes`, { method: "POST", headers }, response => {
      let body = ""; response.on("data", chunk => { body += chunk; });
      response.on("end", () => { clearTimeout(timer); pending.destroy(); resolve({ status: response.statusCode!, body, cache: response.headers["cache-control"] }); });
    });
    const timer = setTimeout(() => { pending.destroy(); reject(new Error("Stalled request exceeded 15 seconds")); }, 15_000);
    pending.on("error", error => { clearTimeout(timer); reject(error); });
    pending.write("{"); // Deliberately leave the upload open.
  });
  expect(result).toEqual({ status: 408, body: '{"code":"invalid"}', cache: "private, no-store" });
  expect(await (await request.get(`${fixture}/fixture/calls`)).json()).toEqual([]);
});

test("production position HTTP saves and reads the same private source without note or progress writes", async ({ request }) => {
  const input = { nodeId: command.nodeId, resourceBindingId: command.resourceBindingId, clientMutationId: command.clientMutationId,
    expectedVersion: 2, expectedPositionVersion: 0, positionSeconds: 0 };
  const saved = await request.post(`${origin}/api/v1/learning-positions`, { headers, data: input });
  expect(saved.status()).toBe(200); expect(saved.headers()["cache-control"]).toBe("private, no-store");
  const position = await saved.json();
  expect(position).toMatchObject({ positionSeconds: 0, positionVersion: 1, expectedPositionVersion: 0, clientMutationId: input.clientMutationId,
    context: { nodeId: input.nodeId, blueprintVersion: 2 }, resource: { bindingId: input.resourceBindingId, videoId: "abcdefghijk" } });
  const read = await request.get(`${origin}/api/v1/learning-positions`, { headers });
  expect(read.status()).toBe(200); expect(read.headers()["cache-control"]).toBe("private, no-store");
  expect((await read.json()).records).toEqual([position]);
  const filtered = await request.get(`${origin}/api/v1/learning-positions?resourceBindingId=${input.resourceBindingId}`, { headers });
  expect(filtered.status()).toBe(200); expect((await filtered.json()).records).toEqual([position]);
  const empty = await request.get(`${origin}/api/v1/learning-positions?resourceBindingId=fd570000-0000-4000-8000-000000000099`, { headers });
  expect(empty.status()).toBe(200); expect((await empty.json()).records).toEqual([]);
  expect(await (await request.get(`${fixture}/fixture/calls`)).json()).toEqual(["/rest/v1/rpc/record_learning_position",
    "/rest/v1/rpc/read_learning_position_workspace", "/rest/v1/rpc/read_learning_position_workspace", "/rest/v1/rpc/read_learning_position_workspace"]);
});

test("production position HTTP rejects an unfinished upload without waiting for EOF or writing a position", async ({ request }) => {
  const result = await new Promise<{ status: number; body: string; cache: string | undefined }>((resolve, reject) => {
    const pending = httpRequest(`${origin}/api/v1/learning-positions`, { method: "POST", headers }, response => {
      let body = ""; response.on("data", chunk => { body += chunk; });
      response.on("end", () => { clearTimeout(timer); pending.destroy(); resolve({ status: response.statusCode!, body, cache: response.headers["cache-control"] }); });
    });
    const timer = setTimeout(() => { pending.destroy(); reject(new Error("Stalled request exceeded 15 seconds")); }, 15_000);
    pending.on("error", error => { clearTimeout(timer); reject(error); });
    pending.write("{");
  });
  expect(result).toEqual({ status: 408, body: '{"code":"invalid"}', cache: "private, no-store" });
  expect(await (await request.get(`${fixture}/fixture/calls`)).json()).toEqual([]);
});
