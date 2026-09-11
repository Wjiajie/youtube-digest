import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { parseTranslationRun } from "./translation-run";
import { createClient } from "@supabase/supabase-js";
import { createTranslationRunWorker } from "./translation-run-worker";
import { createTranslationRunAccess } from "./translation-run-access";

const id = (n: number) => `fd760000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const instructions = "Translate the original caption.";
function ready() {
  return { id: id(1), owner_id: id(2), blueprint_id: id(3), node_id: id(4), binding_id: id(5), video_id: "abcdefghijk",
    source_run_id: id(6), page_offset: 20, target_language: "zh-Hans", status: "ready", created_at: "2026-09-11T00:00:00Z",
    expires_at: "2026-09-11T00:02:00Z", source_started_at: "2026-09-10T00:00:00Z", content_expires_at: "2026-09-12T00:00:00Z",
    retention_policy_ref: "fixture-only", cleared_at: null, clear_reason: null, model: "deepseek-v4-flash",
    skill: { name: "blueprint-translate-transcript", version: "1.0.0", instructions, sha256: createHash("sha256").update(instructions).digest("hex") },
    input_page: { status: "ready", ownerId: id(2), context: { bindingId: id(5), nodeId: id(4), nodeTitle: "实践", goalId: id(7), goalTitle: "摄影", videoId: "abcdefghijk" },
      observedAt: "2026-09-11T00:00:00Z", sourceRunId: id(6), sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
      contentExpiresAt: "2026-09-12T00:00:00Z", title: "Light", language: "en", offset: 20, totalSegments: 21,
      segments: [{ text: "Observe the light.", offsetMs: 300000, durationMs: 10000 }] },
    result: { status: "translated", segments: [{ segmentIndex: 20, translation: "观察光线。" }], providerMayHaveRun: true,
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } },
  };
}

test("a recovered translation preserves its original page and accepts only the expected account and generation", () => {
  const row = ready();
  expect(parseTranslationRun(row, id(2), id(1))).toEqual(row);
  expect(() => parseTranslationRun(row, id(8), id(1))).toThrow();
  expect(() => parseTranslationRun(row, id(2), id(8))).toThrow();
});

test("a cleared receipt is bodyless, and state mismatches cannot masquerade as usable translations", () => {
  const row = ready();
  const tombstone = { ...row, status: "cleared", cleared_at: "2026-09-11T00:01:00Z", clear_reason: "manual",
    input_page: null, skill: null, model: null, result: null };
  expect(parseTranslationRun(tombstone, id(2), id(1)).input_page).toBeNull();
  for (const invalid of [
    { ...tombstone, input_page: row.input_page }, { ...tombstone, skill: row.skill }, { ...tombstone, result: row.result },
    { ...tombstone, cleared_at: null }, { ...row, status: "queued" }, { ...row, result: null },
    { ...row, status: "failed" }, { ...row, skill: null }, { ...row, model: null },
    { ...row, source_started_at: "2026-09-13T00:00:00Z" }, { ...row, unexpected: "raw provider body" },
  ]) expect(() => parseTranslationRun(invalid, id(2), id(1))).toThrow();
});

test("recovery rejects a different original source, page, lifetime or translated segment order", () => {
  for (const change of [
    (row: ReturnType<typeof ready>) => { row.input_page.context.nodeId = id(9); },
    (row: ReturnType<typeof ready>) => { row.input_page.sourceRunId = id(9); },
    (row: ReturnType<typeof ready>) => { row.input_page.contentExpiresAt = "2026-09-13T00:00:00Z"; },
    (row: ReturnType<typeof ready>) => { row.result.segments[0].segmentIndex = 0; },
    (row: ReturnType<typeof ready>) => { row.result.segments.push({ segmentIndex: 21, translation: "额外段落" }); },
    (row: ReturnType<typeof ready>) => { row.skill.sha256 = "0".repeat(64); },
  ]) {
    const row = ready(); change(row);
    expect(() => parseTranslationRun(row, id(2), id(1))).toThrow();
  }
});

test("worker accepts an execution right only with a fresh database observation and the requested model and Skill", async () => {
  const row = ready();
  const running = { ...row, status: "running", result: null };
  for (const { accepted, receipt } of [
    { accepted: true, receipt: { acquired: true, run: running, observed_at: "2026-09-11T00:01:00Z" } },
    { accepted: false, receipt: { acquired: true, run: running, observed_at: "2026-09-10T23:59:59Z" } },
    { accepted: false, receipt: { acquired: true, run: running, observed_at: "2026-09-11T00:02:00Z" } },
    { accepted: false, receipt: { acquired: true, run: { ...running, model: "unexpected-model" }, observed_at: "2026-09-11T00:01:00Z" } },
    { accepted: false, receipt: { acquired: true, run: row, observed_at: "2026-09-11T00:01:00Z" } },
    { accepted: true, receipt: { acquired: false, run: row, observed_at: "2026-09-11T00:03:00Z" } },
  ]) {
    const client = createClient("http://127.0.0.1:54321", "fixture-key", { global: { fetch: async () => new Response(JSON.stringify(receipt)) }, auth: { persistSession: false } });
    const result = await createTranslationRunWorker(client, id(2)).claim({ runId: id(1), leaseId: id(8), skill: { ...row.skill, name: "blueprint-translate-transcript", version: "1.0.0" }, model: row.model });
    expect(result.ok).toBe(accepted);
  }
});

test("begin does not accept a valid receipt for a different video page under the same generation ID", async () => {
  const row = ready();
  const client = createClient("http://127.0.0.1:54321", "fixture-key", { global: { fetch: async () => new Response(JSON.stringify(row)) }, auth: { persistSession: false } });
  const access = createTranslationRunAccess(client, { userId: id(2), client: "web" });
  expect(await access.begin({ runId: id(1), bindingId: id(5), videoId: row.video_id, sourceRunId: id(6), offset: 0, targetLanguage: "zh-Hans" }))
    .toEqual({ ok: false, code: "unavailable" });
});
