import type { TranslationRunResponse } from "@/lib/agent/translation-run-access";

const statuses = { forbidden: 403, not_found: 404, invalid: 422, quota_exhausted: 429, busy: 409, unavailable: 503, cancelled: 409 };
export const translationReply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function translationFailureReply(failure: Extract<TranslationRunResponse, { ok: false }>) {
  return translationReply(failure, statuses[failure.code]);
}
