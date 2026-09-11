import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { parseExplanationRun } from "./explanation-run";
import { createClient } from "@supabase/supabase-js";
import { createExplanationRunAccess } from "./explanation-run-access";
import { createExplanationRunWorker } from "./explanation-run-worker";
import { createCaptionExplainer } from "./caption-explainer";
import { MockLanguageModelV4 } from "ai/test";
import { readFile } from "node:fs/promises";

const id = (n: number) => `fd830000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const instructions = "Explain the selected original caption.";
function ready() {
  return { id: id(1), owner_id: id(2), blueprint_id: id(3), node_id: id(4), binding_id: id(5), video_id: "abcdefghijk",
    source_run_id: id(6), page_offset: 20, target_language: "zh-Hans", status: "ready", created_at: "2026-09-11T00:00:00Z",
    expires_at: "2026-09-11T00:02:00Z", source_started_at: "2026-09-10T00:00:00Z", content_expires_at: "2026-09-12T00:00:00Z",
    retention_policy_ref: "fixture-only", cleared_at: null, clear_reason: null, model: "deepseek-v4-flash",
    request_fingerprint: "a".repeat(64), selection: { start: { segmentIndex: 20, charOffset: 1 }, end: { segmentIndex: 20, charOffset: 4 } }, question: "为什么？",
    skill: { name: "blueprint-explain-selection", version: "1.0.0", instructions, sha256: createHash("sha256").update(instructions).digest("hex") },
    input_page: { status: "ready", ownerId: id(2), context: { bindingId: id(5), nodeId: id(4), nodeTitle: "实践", goalId: id(7), goalTitle: "摄影", videoId: "abcdefghijk" },
      observedAt: "2026-09-11T00:00:00Z", sourceRunId: id(6), sourceBlueprintVersion: 1, sourceCreatedAt: "2026-09-10T00:00:00Z",
      contentExpiresAt: "2026-09-12T00:00:00Z", title: "Light", language: "en", offset: 20, totalSegments: 22,
      segments: [{ text: "A😀B is selected. Do not assume its meaning.", offsetMs: 300000, durationMs: 10000 }, { text: "Context only.", offsetMs: 310000, durationMs: 1000 }] },
    result: { status: "explained", providerMayHaveRun: true, usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      answer: { kind: "explanation", meaning: "选中了符号和字母。", reasoning: "该片段尚未定义符号。", background: null,
        checkQuestion: null, limitations: ["符号的意义未知。"], evidence: [{ segmentIndex: 20, quote: "😀B" }] } },
  };
}

test("a recovered explanation preserves the original UTF-16 selection and explicit question", () => {
  const row = ready();
  expect(parseExplanationRun(row, id(2), id(1))).toEqual(row);
  expect(() => parseExplanationRun(row, id(8), id(1))).toThrow();
  expect(() => parseExplanationRun(row, id(2), id(8))).toThrow();
});

test("the prompt limit counts JSON-escaped control characters, not just selected text length", () => {
  const row = ready();
  row.page_offset = 0; row.input_page.offset = 0; row.input_page.totalSegments = 7;
  row.input_page.segments = Array.from({ length: 7 }, (_, index) => ({ text: index === 1 ? "\u0001".repeat(256) + "A" + "\u0001".repeat(143)
    : "\u0001".repeat(index === 5 ? 655 : 400), offsetMs: index * 1000, durationMs: 1000 }));
  row.selection = { start: { segmentIndex: 1, charOffset: 256 }, end: { segmentIndex: 5, charOffset: 399 } };
  row.result.answer.evidence = [{ segmentIndex: 1, quote: "A" }]; row.question = "";
  expect(parseExplanationRun(row, id(2), id(1))).toEqual(row);
  row.question = "\u0001".repeat(1000);
  expect(() => parseExplanationRun(row, id(2), id(1))).toThrow();
});

test.each(["surrogate", "past-text", "empty", "invented-quote", "broken-unicode", "context-only", "duplicate", "wrong-kind", "wrong-node", "wrong-deadline"])(
  "a persisted receipt cannot bypass source and answer correspondence: %s", kind => {
    const row = ready();
    if (kind === "surrogate") row.selection.start.charOffset = 2;
    if (kind === "past-text") row.selection.end.charOffset = 999;
    if (kind === "empty") row.selection.end.charOffset = 1;
    if (kind === "invented-quote") row.result.answer.evidence[0]!.quote = "fabricated";
    if (kind === "broken-unicode") row.result.answer.evidence[0]!.quote = "\ud83d";
    if (kind === "context-only") row.result.answer.evidence = [{ segmentIndex: 21, quote: "Context only." }];
    if (kind === "duplicate") row.result.answer.evidence.push({ ...row.result.answer.evidence[0]! });
    if (kind === "wrong-kind") row.result.status = "insufficient_context";
    if (kind === "wrong-node") row.input_page.context.nodeId = id(9);
    if (kind === "wrong-deadline") row.input_page.contentExpiresAt = "2026-09-13T00:00:00Z";
    expect(() => parseExplanationRun(row, id(2), id(1))).toThrow();
  });

test("source clearing removes the question and selection as well as every derived body", () => {
  const row = ready(), cleared = { ...row, status: "cleared", cleared_at: "2026-09-11T00:01:00Z", clear_reason: "manual",
    input_page: null, selection: null, question: null, skill: null, model: null, result: null };
  expect(parseExplanationRun(cleared, id(2), id(1))).toEqual(cleared);
  for (const invalid of [{ ...cleared, input_page: row.input_page }, { ...cleared, question: row.question },
    { ...cleared, selection: row.selection }, { ...cleared, result: row.result }, { ...cleared, skill: row.skill },
    { ...cleared, cleared_at: null }, { ...cleared, clear_reason: null }]) expect(() => parseExplanationRun(invalid, id(2), id(1))).toThrow();
});

test("terminal status and retained lifetimes cannot contradict a recovered answer", () => {
  const row = ready();
  for (const invalid of [{ ...row, status: "queued" }, { ...row, status: "failed" }, { ...row, result: null },
    { ...row, skill: null }, { ...row, model: null }, { ...row, status: "cancelled" }, { ...row, status: "interrupted" },
    { ...row, cleared_at: "2026-09-11T00:01:00Z" }, { ...row, question: null }, { ...row, selection: null },
    { ...row, source_started_at: "2026-09-11T00:01:00Z" }, { ...row, expires_at: row.created_at },
    { ...row, expires_at: "2026-09-13T00:00:00Z" }]) expect(() => parseExplanationRun(invalid, id(2), id(1))).toThrow();
});

test("insufficient evidence remains a recoverable answer, while failure and queued cancellation stay bodyless", () => {
  const row = ready();
  const insufficient = { ...row, result: { status: "insufficient_context", providerMayHaveRun: true, usage: null,
    answer: { kind: "insufficient_context", reason: "需要上文中的定义。", missingContext: ["符号定义。"] } } };
  expect(parseExplanationRun(insufficient, id(2), id(1))).toEqual(insufficient);
  const cancelled = { ...row, status: "cancelled", skill: null, model: null, result: { status: "cancelled", providerMayHaveRun: false, usage: null } };
  expect(parseExplanationRun(cancelled, id(2), id(1))).toEqual(cancelled);
  const failed = { ...row, status: "failed", result: { status: "invalid_output", providerMayHaveRun: true, usage: null } };
  expect(parseExplanationRun(failed, id(2), id(1))).toEqual(failed);
  expect(() => parseExplanationRun({ ...failed, result: { ...failed.result, answer: row.result.answer } }, id(2), id(1))).toThrow();
});

test.each(["fresh", "past", "execution-expired", "source-expired", "wrong-model", "ready", "lost-claim"])(
  "execution rights require a fresh database observation: %s", async mode => {
    const row = ready(), run = { ...row, status: "running", result: null };
    const receipt = { acquired: true, run: mode === "ready" ? row : run, observed_at: "2026-09-11T00:01:00Z" };
    if (mode === "past") receipt.observed_at = "2026-09-10T23:59:59Z";
    if (mode === "execution-expired") receipt.observed_at = row.expires_at;
    if (mode === "source-expired") receipt.observed_at = row.content_expires_at;
    if (mode === "wrong-model") run.model = "other";
    if (mode === "lost-claim") { receipt.acquired = false; receipt.observed_at = "2026-09-11T00:03:00Z"; }
    const client = createClient("http://127.0.0.1:54321", "fixture-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async () => Response.json(receipt) } });
    const result = await createExplanationRunWorker(client, id(2)).claim({ runId: id(1), leaseId: id(8),
      skill: { ...row.skill, name: "blueprint-explain-selection", version: "1.0.0" }, model: row.model });
    expect(result.ok).toBe(mode === "fresh" || mode === "lost-claim");
  });

test("caller recovery is account-scoped and rejects substituted question or selection without accepting browser text", async () => {
  const row = ready(), paths: string[] = [];
  const client = createClient("http://127.0.0.1:54321", "fixture-key", { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => { paths.push(new URL(String(input)).pathname); return Response.json(row); } } });
  const access = createExplanationRunAccess(client, { userId: id(2), client: "web" });
  const request = { runId: row.id, bindingId: row.binding_id, videoId: row.video_id, sourceRunId: row.source_run_id,
    offset: row.page_offset, targetLanguage: row.target_language, selection: row.selection, question: row.question };
  expect(await access.begin(request)).toEqual({ ok: true, run: row });
  expect(await access.read(row.id)).toEqual({ ok: true, run: row });
  expect(await access.begin({ ...request, question: "different" })).toEqual({ ok: false, code: "unavailable" });
  expect(await access.begin({ ...request, selection: { ...request.selection, start: { segmentIndex: 20, charOffset: 0 } } }))
    .toEqual({ ok: false, code: "unavailable" });
  expect(await access.begin({ ...request, text: "browser text" })).toEqual({ ok: false, code: "invalid" });
  expect(await access.read("bad-id")).toEqual({ ok: false, code: "invalid" });
  expect(await createExplanationRunAccess(client, { userId: "bad-owner", client: "web" }).cancel(row.id)).toEqual({ ok: false, code: "forbidden" });
  expect(paths).toEqual(["/rest/v1/rpc/begin_explanation_run", "/rest/v1/rpc/read_explanation_run", "/rest/v1/rpc/begin_explanation_run", "/rest/v1/rpc/begin_explanation_run"]);
});

test("finding an existing question never starts it and accepts only an identity-only receipt", async () => {
  const row = ready(), requests: string[] = [];
  let response: unknown = { run_id: row.id };
  const client = createClient("http://127.0.0.1:54321", "fixture-key", { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => { requests.push(String(input)); expect(JSON.parse(String(init?.body))).not.toHaveProperty("p_request.runId"); return Response.json(response); } } });
  const access = createExplanationRunAccess(client, { userId: id(2), client: "extension" });
  const query = { bindingId: row.binding_id, videoId: row.video_id, sourceRunId: row.source_run_id,
    offset: row.page_offset, targetLanguage: row.target_language, selection: row.selection, question: row.question };
  expect(await access.find(query)).toEqual({ ok: true, runId: row.id });
  response = { run_id: null }; expect(await access.find(query)).toEqual({ ok: true, runId: null });
  response = { run_id: row.id, answer: "PRIVATE" }; expect(await access.find(query)).toEqual({ ok: false, code: "unavailable" });
  expect(await access.find({ ...query, runId: row.id })).toEqual({ ok: false, code: "invalid" });
  const controller = new AbortController(); controller.abort();
  expect(await access.find(query, controller.signal)).toEqual({ ok: false, code: "cancelled" });
  expect(requests).toHaveLength(3); expect(requests.every(url => url.endsWith("/rpc/find_explanation_run"))).toBe(true);
});

test("service completion persists only the answer and usage bound to its claimed selection, question and Skill", async () => {
  const row = ready();
  row.skill.instructions = await readFile(new URL("./skills/explain-selection/v1/SKILL.md", import.meta.url), "utf8");
  row.skill.sha256 = createHash("sha256").update(row.skill.instructions).digest("hex");
  const run = parseExplanationRun({ ...row, status: "running", result: null }, id(2), id(1));
  const model = new MockLanguageModelV4({ doGenerate: { content: [{ type: "text", text: JSON.stringify(row.result.answer) }],
    finishReason: { unified: "stop", raw: undefined }, warnings: [],
    usage: { inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 3, text: 3, reasoning: undefined } } } });
  const result = await createCaptionExplainer({ model }).run({ generationId: run.id, ownerId: id(2),
    request: { bindingId: row.binding_id, videoId: row.video_id, sourceRunId: row.source_run_id, offset: row.page_offset },
    transcript: row.input_page, selection: row.selection, question: row.question, sourceReadStartedAt: performance.now(), signal: new AbortController().signal });
  if (result.status !== "explained") throw new Error("Expected explanation");
  const calls: { path: string; args: unknown }[] = [];
  let savedReceipt: unknown = row;
  const client = createClient("http://127.0.0.1:54321", "fixture-key", { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => { const path = new URL(String(input)).pathname; calls.push({ path, args: JSON.parse(String(init?.body)) });
      return Response.json(path.endsWith("claim_explanation_run") ? { acquired: true, run, observed_at: "2026-09-11T00:01:00Z" } : savedReceipt); } } });
  const worker = createExplanationRunWorker(client, id(2));
  expect(await worker.claim({ runId: run.id, leaseId: id(8), skill: run.skill!, model: row.model })).toMatchObject({ ok: true, acquired: true, run });
  expect(await worker.finish({ runId: run.id, leaseId: id(8), run, result })).toEqual({ ok: true, run: row });
  expect(calls[1]?.args).toEqual({ p_owner_id: id(2), p_run_id: run.id, p_lease_id: id(8), p_result: row.result });
  for (const invalid of [{ ...result, generationId: id(9) }, { ...result, requestSha256: "0".repeat(64) },
    { ...result, source: { ...result.source, bindingId: id(9) } }, { ...result, skill: { ...result.skill, sha256: "0".repeat(64) } },
    { ...result, selected: [] }]) expect(await worker.finish({ runId: run.id, leaseId: id(8), run, result: invalid })).toEqual({ ok: false, code: "invalid" });
  expect(calls).toHaveLength(2);
  savedReceipt = { ...row, question: "Different question under the same receipt identity" };
  expect(await worker.finish({ runId: run.id, leaseId: id(8), run, result })).toEqual({ ok: false, code: "unavailable" });
  savedReceipt = { ...row, result: { ...row.result, answer: { ...row.result.answer, meaning: "Different answer" } } };
  expect(await worker.finish({ runId: run.id, leaseId: id(8), run, result })).toEqual({ ok: false, code: "unavailable" });
});
