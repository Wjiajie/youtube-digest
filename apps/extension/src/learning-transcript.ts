import { browser } from "wxt/browser";
import { learningTranscriptRequestSchema, parseLearningTranscript, type ApplicationResult, type LearningTranscript } from "@blueprint/domain";
import type { createExtensionAuthPort } from "./auth";
import { createAuthenticatedTransport } from "./authenticated-transport";

type Sender = { id?: string; url?: string; tab?: { url?: string } };
type Selection = { expectedTabId?: unknown; nodeId?: unknown };
const unavailable = { ok: false, code: "unavailable" } as const;
function watchId(raw?: string) {
  try {
    const url = new URL(raw ?? "");
    return url.origin === "https://www.youtube.com" && url.pathname === "/watch" && url.searchParams.getAll("v").length === 1
      ? url.searchParams.get("v") : null;
  } catch { return null; }
}

/** A sidepanel-only read of the selected binding, never a provider request or persistent caption cache. */
export function createLearningTranscriptReader(auth: ReturnType<typeof createExtensionAuthPort>, apiBase: string) {
  const { authorize, request } = createAuthenticatedTransport(auth, apiBase);
  return async (ownerId: unknown, input: unknown, selection: Selection, sender?: Sender): Promise<ApplicationResult<LearningTranscript>> => {
    try {
      const panelUrl = browser.runtime.getURL("/sidepanel.html");
      if (!sender || sender.id !== browser.runtime.id || sender.url !== panelUrl || sender.tab !== undefined && sender.tab.url !== panelUrl)
        return { ok: false, code: "forbidden" };
      const parsed = learningTranscriptRequestSchema.safeParse(input);
      if (!parsed.success || !Number.isInteger(selection.expectedTabId) || Number(selection.expectedTabId) < 0
        || typeof selection.nodeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.nodeId))
        return { ok: false, code: "invalid" };
      const command = parsed.data;
      const identity = await authorize(ownerId);
      if (!identity.ok) return identity;
      const [before] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!before || before.id !== selection.expectedTabId || watchId(before.url) !== command.videoId
        || before.pendingUrl && watchId(before.pendingUrl) !== command.videoId) return unavailable;
      const query = new URLSearchParams({ bindingId: command.bindingId, videoId: command.videoId, offset: String(command.offset) });
      if (command.sourceRunId !== null) query.set("sourceRunId", command.sourceRunId);
      const result = await request(identity.value, `learning-transcript?${query}`, value => parseLearningTranscript(value, identity.value.session.userId, command));
      const [after] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!await auth.isCurrent(identity.value.token)) return { ok: false, code: "forbidden" };
      if (!after || after.id !== before.id || watchId(after.url) !== command.videoId
        || after.pendingUrl && watchId(after.pendingUrl) !== command.videoId) return unavailable;
      if (result.ok && result.value.context.nodeId !== selection.nodeId.toLowerCase()) return unavailable;
      return result;
    } catch { return unavailable; }
  };
}
