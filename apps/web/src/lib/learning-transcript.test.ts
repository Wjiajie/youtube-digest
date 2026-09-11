import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { readLearningTranscript } from "./learning-transcript";
const owner = "ef680000-0000-4000-8000-000000000001", binding = "ef680000-0000-4000-8000-000000000002";
const input = { bindingId: binding, videoId: "abcdefghijk" };
const value = { ownerId: owner, context: { bindingId: binding, nodeId: owner, nodeTitle: "曝光", goalId: owner, goalTitle: "摄影", videoId: input.videoId },
  observedAt: "2026-09-11T00:00:00Z", status: "unavailable", reason: "not_acquired" };
test("reads a narrow transcript RPC with caller credentials and verifies the returned owner and requested video", async () => {
  const requests: unknown[] = [];
  const client = createClient("https://supabase.example.test", "publishable-test", { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (url, init) => { requests.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return Response.json(value); },
  } });
  expect(await readLearningTranscript(client, { userId: owner, client: "web" }, input)).toEqual({ ok: true, value });
  expect(requests).toEqual([{ url: "https://supabase.example.test/rest/v1/rpc/read_learning_transcript", body: {
    p_resource_binding_id: binding, p_video_id: input.videoId, p_source_run_id: null, p_offset: 0,
  } }]);
  expect(await readLearningTranscript(client, { userId: binding, client: "extension" }, input)).toEqual({ ok: false, code: "unavailable" });
  expect(await readLearningTranscript(client, { userId: owner, client: "web" }, { ...input, offset: 20 })).toEqual({ ok: false, code: "invalid" });
  expect(requests).toHaveLength(2);
});

test("an aborted source read cannot return caption material", async () => {
  const controller = new AbortController(); controller.abort();
  const client = createClient("https://supabase.example.test", "publishable-test", { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (_url, init) => { init?.signal?.throwIfAborted(); return Response.json(value); },
  } });
  expect(await readLearningTranscript(client, { userId: owner, client: "extension" }, input, controller.signal))
    .toEqual({ ok: false, code: "unavailable" });
});
