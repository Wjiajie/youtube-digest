import { browser } from "wxt/browser";

import { accountPreferencesSchema, parseBlueprintSnapshot, type BlueprintSnapshot } from "@blueprint/domain";

import { createExtensionAuthPort } from "../src/auth";
import { initExtensionObservability } from "../src/observability";
import { createEvidenceTransport } from "../src/evidence";
import { findBoundNode, flushOutbox, type OutboxCommand } from "../src/runtime";

const OUTBOX_KEY = "blueprint_session_outbox_v1";
const CLEANUP_KEY = "blueprint_v3_cleanup_complete";
const REQUEST_TIMEOUT_MS = 15_000;
const apiBase = (import.meta.env.WXT_PUBLIC_WEB_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
let preferencesRequest = 0;
let preferencesCacheWrite = Promise.resolve();
let blueprintCacheWrite = Promise.resolve();
type AuthPort = ReturnType<typeof createExtensionAuthPort>;
type AuthorizedSession = NonNullable<Awaited<ReturnType<AuthPort["accessToken"]>>>;

export default defineBackground(() => {
  initExtensionObservability();
  const auth = createExtensionAuthPort();
  const evidence = createEvidenceTransport(auth, apiBase);
  void cleanupLegacyStorage();
  void auth.accessToken().then((current) => current && retryOutbox(auth, current.session.userId));
  if (globalThis.chrome?.sidePanel) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  browser.runtime.onMessage.addListener(async (message: any) => {
    switch (message?.type) {
      case "AUTH_STATUS":
        return auth.status();
      case "AUTH_CONNECT":
        return auth.connect();
      case "AUTH_DISCONNECT":
        await auth.disconnect();
        return { connected: false };
      case "LOAD_CONTEXT":
        return loadContext(auth);
      case "LOAD_PREFERENCES":
        return loadPreferences(auth);
      case "LOAD_EVIDENCE":
        return evidence.load(message.ownerId);
      case "SAVE_EVIDENCE":
        return evidence.save(message.ownerId, message.input);
      case "START_SESSION":
        return startSession(auth, message.context);
      case "RETRY_OUTBOX": {
        const current = await auth.accessToken();
        return current ? retryOutbox(auth, current.session.userId) : { recovered: 0, pending: 0, rejected: 0 };
      }
      case "OPEN_NODE":
        await browser.tabs.update(message.tabId, { url: message.url });
        return { ok: true };
      case "OPEN_WEB":
        await browser.tabs.create({ url: apiBase });
        return { ok: true };
      default:
        return undefined;
    }
  });
});

async function loadContext(auth: ReturnType<typeof createExtensionAuthPort>) {
  const current = await auth.accessToken();
  if (!current) return { connected: false };
  const preferencesRead = loadPreferences(auth, current);
  // The context may exit early on revocation; keep the independent read's
  // rejection handled even when its result is no longer needed.
  void preferencesRead.catch(() => undefined);
  let snapshot: BlueprintSnapshot | null = null;
  let stale = false;
  try {
    const response = await fetch(`${apiBase}/api/v1/blueprint`, {
      headers: { Authorization: `Bearer ${current.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!await auth.isCurrent(current.token)) return { superseded: true as const };
    if (response.status === 401) {
      await auth.invalidate(current.token);
      return { connected: false };
    }
    if (!response.ok) throw new Error("BLUEPRINT_FETCH_FAILED");
    snapshot = parseBlueprintSnapshot(await response.json());
    if (!await auth.isCurrent(current.token)) return { superseded: true as const };
    const cacheKey = `blueprint_cache:${current.session.userId}`;
    const write = blueprintCacheWrite.then(async () => {
      if (!await auth.isCurrent(current.token)) return;
      await browser.storage.local.set({ [cacheKey]: snapshot });
      // Auth can change while Chrome is persisting the snapshot. Complete any
      // obsolete write's cleanup before a newer session writes this cache.
      if (!await auth.isCurrent(current.token)) await browser.storage.local.remove(cacheKey);
    });
    blueprintCacheWrite = write.catch(() => undefined);
    await write;
  } catch {
    await blueprintCacheWrite;
    if (!await auth.isCurrent(current.token)) return { superseded: true as const };
    const cached = await browser.storage.local.get(`blueprint_cache:${current.session.userId}`);
    snapshot = cached[`blueprint_cache:${current.session.userId}`]
      ? parseBlueprintSnapshot(cached[`blueprint_cache:${current.session.userId}`])
      : null;
    stale = true;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url ?? "";
  const context = snapshot ? findBoundNode(snapshot, currentUrl) : null;
  const nodes = snapshot
    ? snapshot.goals.flatMap((goal) => goal.stages.flatMap((stage) => stage.nodes.flatMap((node) => node.resources.map((resource) => ({
        goalTitle: goal.title,
        stageTitle: stage.title,
        nodeId: node.id,
        nodeTitle: node.title,
        resourceBindingId: resource.id,
        url: resource.url,
      })))))
    : [];
  const pending = (await readOutbox()).filter((item) => item.ownerId === current.session.userId).length;
  if (!await auth.isCurrent(current.token)) return { superseded: true as const };
  const preferenceResult = await preferencesRead;
  if ("connected" in preferenceResult && !preferenceResult.connected) return preferenceResult;
  if (!await auth.isCurrent(current.token)) return { superseded: true as const };
  // Another panel's preference refresh can supersede this theme read without
  // superseding the video context. Use the latest accepted account cache.
  const preferences = "superseded" in preferenceResult ? await cachedPreferences(current) : preferenceResult;
  if (!await auth.isCurrent(current.token)) return { superseded: true as const };
  return {
    ...preferences,
    connected: true,
    email: current.session.email,
    userId: current.session.userId,
    snapshot,
    context,
    nodes,
    tabId: tab?.id,
    stale,
    pending,
  };
}

async function loadPreferences(auth: AuthPort, authorized?: AuthorizedSession) {
  const request = ++preferencesRequest;
  const current = authorized ?? await auth.accessToken();
  if (!current) return { connected: false as const };
  const ownerId = current.session.userId;
  const cacheKey = `blueprint_preferences:${ownerId}`;
  const isCurrent = async () => request === preferencesRequest && await auth.isCurrent(current.token);
  try {
    const response = await fetch(`${apiBase}/api/v1/account-preferences`, {
      headers: { Authorization: `Bearer ${current.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!await isCurrent()) return { superseded: true as const };
    if (response.status === 401) {
      await auth.invalidate(current.token);
      return { connected: false as const };
    }
    if (!response.ok) throw new Error("PREFERENCES_FETCH_FAILED");
    const preferences = accountPreferencesSchema.parse(await response.json());
    if (!await isCurrent()) return { superseded: true as const };
    // Serialize writes as well as checking responses: a slow storage operation
    // must not finish after and overwrite the next accepted preference.
    const write = preferencesCacheWrite.then(async () => {
      if (!await isCurrent()) return;
      await browser.storage.local.set({ [cacheKey]: { ownerId, preferences } });
      if (!await auth.isCurrent(current.token)) await browser.storage.local.remove(cacheKey);
    });
    preferencesCacheWrite = write.catch(() => undefined);
    await write;
    if (!await isCurrent()) return { superseded: true as const };
    return { connected: true as const, userId: ownerId, preferences, preferencesStatus: "current" as const };
  } catch {
    const cached = await cachedPreferences(current);
    if (!await isCurrent()) return { superseded: true as const };
    return cached;
  }
}

async function cachedPreferences(current: AuthorizedSession) {
  await preferencesCacheWrite;
  const ownerId = current.session.userId;
  const cacheKey = `blueprint_preferences:${ownerId}`;
  const cached = (await browser.storage.local.get(cacheKey))[cacheKey];
  const parsed = accountPreferencesSchema.safeParse(
    typeof cached === "object" && cached !== null && "ownerId" in cached && cached.ownerId === ownerId && "preferences" in cached
      ? cached.preferences : null,
  );
  return { connected: true as const, userId: ownerId, preferences: parsed.success ? parsed.data : null, preferencesStatus: parsed.success ? "cached" as const : "unavailable" as const };
}

async function startSession(
  auth: ReturnType<typeof createExtensionAuthPort>,
  context: { nodeId: string; resourceBindingId?: string },
) {
  const current = await auth.accessToken();
  if (!current) return { ok: false, code: "unauthenticated" };
  const command: OutboxCommand = {
    ownerId: current.session.userId,
    nodeId: context.nodeId,
    ...(context.resourceBindingId ? { resourceBindingId: context.resourceBindingId } : {}),
    startedAt: new Date().toISOString(),
    clientMutationId: crypto.randomUUID(),
    attempts: 0,
  };
  const delivery = await sendSession(current.token, command);
  if (delivery === "sent") return { ok: true, queued: false };
  if (delivery === "rejected") return { ok: false, code: "authorization_or_data_rejected" };
  command.failureRecorded = await sendSyncEvent(
    current.token,
    "failed",
    "network_or_service_unavailable",
  );
  const outbox = await readOutbox();
  await browser.storage.local.set({ [OUTBOX_KEY]: [...outbox, command] });
  return { ok: true, queued: true };
}

async function retryOutbox(
  auth: ReturnType<typeof createExtensionAuthPort>,
  userId: string,
) {
  const current = await auth.accessToken();
  if (!current || current.session.userId !== userId) return { recovered: 0, pending: 0 };
  const result = await flushOutbox(await readOutbox(), userId, (command) => sendSession(current.token, command));
  await browser.storage.local.set({ [OUTBOX_KEY]: result.remaining });
  if (result.recovered) {
    if (result.recoveredCommands.some((command) => !command.failureRecorded)) {
      await sendSyncEvent(current.token, "failed", "recovered_after_offline");
    }
    await sendSyncEvent(current.token, "recovered");
  }
  return {
    recovered: result.recovered,
    rejected: result.rejected,
    pending: result.remaining.filter((item) => item.ownerId === userId).length,
  };
}

async function sendSyncEvent(token: string, outcome: "failed" | "recovered", resultCode?: string) {
  try {
    const response = await fetch(`${apiBase}/api/v1/events/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ outcome, resultCode }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendSession(token: string, command: OutboxCommand): Promise<"sent" | "retryable" | "rejected"> {
  try {
    const response = await fetch(`${apiBase}/api/v1/learning-sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        nodeId: command.nodeId,
        resourceBindingId: command.resourceBindingId,
        clientMutationId: command.clientMutationId,
        startedAt: command.startedAt,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return "sent";
    return response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
      ? "retryable"
      : "rejected";
  } catch {
    return "retryable";
  }
}

async function readOutbox(): Promise<OutboxCommand[]> {
  const stored = await browser.storage.local.get(OUTBOX_KEY);
  return Array.isArray(stored[OUTBOX_KEY]) ? stored[OUTBOX_KEY] as OutboxCommand[] : [];
}

async function cleanupLegacyStorage() {
  const stored = await browser.storage.local.get(null);
  if (stored[CLEANUP_KEY]) return;
  const exact = [
    "blueprint_state_v1",
    "blueprint_planner_messages_v1",
    "ytd_settings",
    "ytd_options_language",
    "ytd_notes",
  ];
  const keys = [...exact, ...Object.keys(stored).filter((key) => key.startsWith("digest_"))];
  if (keys.length) await browser.storage.local.remove(keys);
  await browser.storage.local.set({ [CLEANUP_KEY]: true });
}
