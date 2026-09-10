import { createVerifiedWorker, object, exact, uuid, skill, usage, string, integer, array, type RecordValue, type Environment, type ClientFactory } from "../_shared/verified-worker.ts";

type ResourceRpc = "claim_resource_run" | "finish_resource_run" | "claim_resource_adoption" | "finish_resource_adoption";
const videoId = (value: unknown) => string(value, 11, 11) && /^[A-Za-z0-9_-]{11}$/.test(value);
const language = (value: unknown) => string(value, 21, 2) && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(value);
const region = (value: unknown) => string(value, 2, 2) && /^[A-Z]{2}$/.test(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const count = (value: unknown) => value === null || (string(value, 128, 1) && /^\d+$/.test(value));
const oneOf = (value: unknown, choices: readonly string[]) => typeof value === "string" && choices.includes(value);
const failures = ["invalid_input", "unavailable", "rate_limited", "cancelled", "timed_out", "not_found"];
function timestamp(value: unknown): boolean {
  if (!string(value, 64, 20) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10), parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day;
}
function source(value: unknown, matching = false): value is RecordValue {
  return object(value) && exact(value, ["blueprintId", "blueprintVersion", "nodeId", "checkedAt", ...(matching ? ["evidenceSha256"] : [])])
    && uuid(value.blueprintId) && integer(value.blueprintVersion, 0) && uuid(value.nodeId) && timestamp(value.checkedAt);
}
function requests(value: unknown): boolean {
  return object(value) && exact(value, ["catalogMayHaveRun", "transcriptVideoIds"])
    && typeof value.catalogMayHaveRun === "boolean" && array(value.transcriptVideoIds, 3, videoId);
}
function video(value: unknown): boolean {
  return object(value) && exact(value, ["videoId", "title", "description", "channelId", "channelTitle", "publishedAt", "durationSeconds", "audioLanguage", "defaultLanguage", "captionAvailable", "privacyStatus", "uploadStatus", "liveBroadcastContent", "embeddable", "allowedRegions", "blockedRegions", "ageRestricted", "statistics"])
    && videoId(value.videoId) && string(value.title, 1000, 1) && string(value.description, 20000) && string(value.channelId, 200, 1) && string(value.channelTitle, 1000, 1)
    && timestamp(value.publishedAt) && integer(value.durationSeconds, 0) && (value.audioLanguage === null || language(value.audioLanguage))
    && (value.defaultLanguage === null || language(value.defaultLanguage)) && typeof value.captionAvailable === "boolean"
    && oneOf(value.privacyStatus, ["public", "unlisted", "private"]) && oneOf(value.uploadStatus, ["processed", "uploaded", "failed", "rejected", "deleted"])
    && oneOf(value.liveBroadcastContent, ["none", "live", "upcoming"]) && typeof value.embeddable === "boolean"
    && (value.allowedRegions === null || array(value.allowedRegions, 500, region)) && array(value.blockedRegions, 500, region)
    && typeof value.ageRestricted === "boolean" && object(value.statistics) && exact(value.statistics, ["viewCount", "likeCount", "commentCount"])
    && Object.values(value.statistics).every(count);
}
function transcript(value: unknown): value is RecordValue {
  if (!object(value)) return false;
  if (value.status === "pending") return exact(value, ["status", "jobId"]) && string(value.jobId, 200, 1) && /^[A-Za-z0-9_-]+$/.test(value.jobId);
  if (value.status !== "ready") return exact(value, ["status"]) && oneOf(value.status, failures);
  return exact(value, ["status", "language", "availableLanguages", "segments"]) && language(value.language) && array(value.availableLanguages, 500, language)
    && array(value.segments, 20000, item => object(item) && exact(item, ["text", "offset", "duration"], ["lang"])
      && string(item.text, 20000, 1) && item.text.trim().length > 0 && number(item.offset) && number(item.duration)
      && item.offset + item.duration <= Number.MAX_SAFE_INTEGER && (!Object.hasOwn(item, "lang") || language(item.lang)), 1);
}
function candidate(value: unknown): value is RecordValue {
  return object(value) && exact(value, ["video", "url", "transcript", "languageFallback", "eligibleForMatching", "matching"])
    && object(value.video) && video(value.video) && value.url === `https://www.youtube.com/watch?v=${value.video.videoId}` && transcript(value.transcript)
    && typeof value.eligibleForMatching === "boolean" && value.matching === "not_evaluated"
    && (value.transcript.status === "ready" ? typeof value.languageFallback === "boolean" : value.languageFallback === null && value.eligibleForMatching === false);
}
function result(value: unknown): value is RecordValue {
  if (!object(value)) return false;
  if (oneOf(value.status, [...failures, "not_applicable", "invalid_output", "no_evidence"])) {
    return exact(value, ["status"], ["requests", "providerMayHaveRun", "usage"])
      && (!Object.hasOwn(value, "requests") || requests(value.requests))
      && (!Object.hasOwn(value, "providerMayHaveRun") || typeof value.providerMayHaveRun === "boolean")
      && (!Object.hasOwn(value, "usage") || value.usage === null || usage(value.usage));
  }
  if (value.status === "matched" || value.status === "no_match") return matched(value);
  if (!source(value.source) || !requests(value.requests)
    || !array(value.rejected, 10, item => object(item) && exact(item, ["videoId", "reason"]) && videoId(item.videoId)
      && oneOf(item.reason, ["not_public", "not_processed", "live_or_upcoming", "region_restricted", "age_restricted", "duration_exceeded", "future_publication", "before_requested_date"]))) return false;
  if (value.status === "no_candidates") return exact(value, ["status", "source", "requests", "rejected"]);
  if (value.status !== "discovered" || !exact(value, ["status", "source", "requests", "candidates", "rejected", "uninspectedVideoIds"])
    || !array(value.candidates, 3, candidate, 1) || !array(value.uninspectedVideoIds, 7, videoId)) return false;
  // Identity consistency only; provider suitability and ranking remain Node responsibilities.
  const ids = new Set(), jobs = new Set();
  for (const item of value.candidates as RecordValue[]) {
    const metadata = item.video as RecordValue, captions = item.transcript as RecordValue;
    if (ids.has(metadata.videoId)) return false;
    ids.add(metadata.videoId);
    if (captions.status === "pending") { if (jobs.has(captions.jobId)) return false; jobs.add(captions.jobId); }
  }
  return true;
}
const prose = (value: unknown, max: number) => string(value, max, 1) && value.trim().length > 0;
function matched(value: RecordValue): boolean {
  return exact(value, ["status", "reviewRequired", "providerMayHaveRun", "usage", "source", "skill", "summary", "assessments", "coverage"])
    && value.reviewRequired === true && value.providerMayHaveRun === true && usage(value.usage) && source(value.source, true)
    && string(value.source.evidenceSha256, 64, 64) && /^[a-f0-9]{64}$/.test(value.source.evidenceSha256)
    && object(value.skill) && exact(value.skill, ["name", "version", "sha256"]) && value.skill.name === "blueprint-match-resources"
    && string(value.skill.version, 64, 1) && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.skill.version)
    && string(value.skill.sha256, 64, 64) && /^[a-f0-9]{64}$/.test(value.skill.sha256) && prose(value.summary, 600)
    && array(value.assessments, 3, item => object(item) && exact(item, ["videoId", "role", "relevance", "levelFit", "languageFit", "timeFit", "freshness", "limitations", "evidence"])
      && videoId(item.videoId) && oneOf(item.role, ["recommended", "alternative", "rejected"])
      && [item.relevance, item.levelFit, item.languageFit, item.timeFit, item.freshness].every(text => prose(text, 400))
      && array(item.limitations, 3, text => prose(text, 240)) && array(item.evidence, 2, evidence => object(evidence)
        && exact(evidence, ["segmentIndex", "quote", "offsetMs"]) && integer(evidence.segmentIndex, 0) && prose(evidence.quote, 200) && number(evidence.offsetMs), 1), 1)
    && array(value.coverage, 3, item => object(item) && exact(item, ["videoId", "totalSegments", "sampledSegments", "textTruncated"])
      && videoId(item.videoId) && integer(item.totalSegments, 1) && integer(item.sampledSegments, 1, 24) && typeof item.textTruncated === "boolean", 1);
}
const safeErrors: Record<string, string[]> = {
  "42501": ["RESOURCE_FORBIDDEN", "RESOURCE_ADOPTION_FORBIDDEN"], P0002: ["RESOURCE_NOT_FOUND", "RESOURCE_ADOPTION_NOT_FOUND"],
  "22023": ["RESOURCE_INVALID", "RESOURCE_INVALID_SKILL", "RESOURCE_INVALID_RESULT", "RESOURCE_COMPLETION_REUSED", "RESOURCE_INVALID_STATE", "RESOURCE_RUN_REUSED", "RESOURCE_SOURCE_CONSUMED",
    "RESOURCE_ADOPTION_INVALID", "RESOURCE_ADOPTION_RUN_REUSED", "RESOURCE_ADOPTION_INVALID_STATE", "RESOURCE_ADOPTION_INVALID_RESULT", "RESOURCE_ADOPTION_COMPLETION_REUSED"],
  "40001": ["RESOURCE_VERSION_CONFLICT", "RESOURCE_ADOPTION_SOURCE_CHANGED", "RESOURCE_ADOPTION_VERIFICATION_EXPIRED"],
  "23514": ["RESOURCE_ADOPTION_PROPOSAL_INVALID"],
  P0001: ["RESOURCE_BUSY", "RESOURCE_QUOTA_EXHAUSTED", "RESOURCE_ADOPTION_BUSY", "RESOURCE_ADOPTION_QUOTA_EXHAUSTED", "RESOURCE_RETENTION_UNAVAILABLE"],
};

function verification(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.status !== "verified") return exact(value, ["status"]) && oneOf(value.status, [...failures, "not_available", "changed"]);
  const v = value.video;
  return exact(value, ["status", "video"]) && object(v) && exact(v, ["videoId", "title", "channelTitle", "publishedAt", "durationSeconds"])
    && videoId(v.videoId) && string(v.title, 500, 1) && string(v.channelTitle, 500, 1) && timestamp(v.publishedAt) && integer(v.durationSeconds, 1, 86400);
}

/** Fixed persistence operations; discovery and inference remain in the Node runner. */
export function createResourceWorker(env: Environment, createClient: ClientFactory<ResourceRpc>, forbiddenSecrets: readonly string[] = []) {
  const reused = forbiddenSecrets.some(value => value.trim().length > 0 && value.trim() === env.workerSecret);
  return createVerifiedWorker({ ...env, workerSecret: reused ? "" : env.workerSecret }, createClient, {
    bodyLimit: 8 * 1024 * 1024, errorPrefix: "RESOURCE", safeErrors,
    decodeOperation(payload) {
      if (!object(payload) || !uuid(payload.leaseId)) return null;
      if (payload.operation === "adoption_claim" && exact(payload, ["operation", "adoptionId", "leaseId"]) && uuid(payload.adoptionId)) {
        return { name: "claim_resource_adoption", args: { p_adoption_id: payload.adoptionId, p_lease_id: payload.leaseId } };
      }
      if (payload.operation === "adoption_finish" && exact(payload, ["operation", "adoptionId", "leaseId", "result"]) && uuid(payload.adoptionId) && verification(payload.result)) {
        return { name: "finish_resource_adoption", args: { p_adoption_id: payload.adoptionId, p_lease_id: payload.leaseId, p_result: payload.result } };
      }
      if (!uuid(payload.runId)) return null;
      if (payload.operation === "claim" && exact(payload, ["operation", "runId", "leaseId", "skill"])
        && (payload.skill === null || skill(payload.skill, "blueprint-match-resources"))) {
        return { name: "claim_resource_run", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_skill: payload.skill } };
      }
      if (payload.operation === "finish" && exact(payload, ["operation", "runId", "leaseId", "result"]) && result(payload.result)) {
        return { name: "finish_resource_run", args: { p_run_id: payload.runId, p_lease_id: payload.leaseId, p_result: payload.result } };
      }
      return null;
    },
  });
}
