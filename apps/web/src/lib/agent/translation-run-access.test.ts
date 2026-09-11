import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { createTranslationRunAccess } from "./translation-run-access";

const ownerId = "fd760000-0000-4000-8000-000000000002";
const runId = "fd760000-0000-4000-8000-000000000001";
test("recovery returns safe errors without provider execution and rejects non-Web actors or invalid requests locally", async () => {
  const urls: string[] = [];
  const client = createClient("http://127.0.0.1:54321", "fixture-key", { global: { fetch: async input => {
    urls.push(String(input)); return new Response(JSON.stringify({ code: "P0002", message: "PRIVATE_DATABASE_DETAIL" }), { status: 404 });
  } }, auth: { persistSession: false, autoRefreshToken: false } });
  const access = createTranslationRunAccess(client, { userId: ownerId, client: "web" });
  expect(await access.read(runId)).toEqual({ ok: false, code: "not_found" });
  expect(await access.cancel(runId)).toEqual({ ok: false, code: "not_found" });
  expect(await access.begin({ runId, ownerId, transcript: "untrusted" })).toEqual({ ok: false, code: "invalid" });
  expect(await access.read("bad-id")).toEqual({ ok: false, code: "invalid" });
  expect(await createTranslationRunAccess(client, { userId: ownerId, client: "extension" }).read(runId)).toEqual({ ok: false, code: "forbidden" });
  expect(urls.map(url => new URL(url).pathname)).toEqual(["/rest/v1/rpc/read_translation_run", "/rest/v1/rpc/cancel_translation_run"]);
});
