import type { GoalBriefContent } from "@blueprint/domain";

/** Client-facing projection only; never includes Skill instructions or execution leases. */
export type ClarificationSessionView = {
  id: string; briefId: string; sourceRevision: number; revision: number; updatedAt: string;
  status: "active" | "closed" | "stale"; mode: "needs_input" | "reviewable" | "paused";
  question: string; content: GoalBriefContent;
};
export type ClarificationTurnView = {
  id: string; ordinal: number; createdAt: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled" | "interrupted" | "stale";
  question: string; answer: string; skillVersion: string | null;
  suggestion: null | {
    mode: "needs_input" | "reviewable" | "paused"; reflection: string; concerns: string[];
    changes: Array<{ field: "outcome" | "startingPoint" | "targetDate" | "weeklyMinutes" | "constraints" | "successCriteria";
      value: string | number | null; quote: string }>;
  };
};
export type ClarificationSnapshot = {
  session: ClarificationSessionView; turns: ClarificationTurnView[]; offset: number; hasMore: boolean;
};
export type ClarificationUiFailure = { ok: false; code: "forbidden" | "unauthenticated" | "invalid" | "not_found" |
  "version_conflict" | "busy" | "quota_exhausted" | "window_full" | "cancelled" | "unavailable" | "disabled" };
export type ClarificationUiResult<T> = { ok: true; value: T } | ClarificationUiFailure;
export type ClarificationWorkbenchProps = {
  accountId: string; initial: ClarificationSnapshot; enabled: boolean; pendingTurnId: string | null;
  readAction: (offset?: number) => Promise<ClarificationUiResult<ClarificationSnapshot>>;
  readTurnAction: (turnId: string) => Promise<ClarificationUiResult<ClarificationTurnView>>;
  cancelAction: (turnId: string) => Promise<ClarificationUiResult<ClarificationTurnView>>;
  editAction: (input: { expectedRevision: number; content: GoalBriefContent; clientMutationId: string }) => Promise<ClarificationUiResult<ClarificationSessionView>>;
  saveAction: (input: { expectedRevision: number; confirm: boolean; clientMutationId: string }) => Promise<ClarificationUiResult<{ session: ClarificationSessionView; briefId: string; confirmed: boolean }>>;
};
