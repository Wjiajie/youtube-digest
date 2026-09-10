import { browser } from "wxt/browser";
import type { ApplicationResult } from "@blueprint/domain";
import type { createExtensionAuthPort } from "./auth";

type Position = { videoId: string; positionSeconds: number };
type Sender = { id?: string; url?: string; tab?: unknown };
const unavailable = { ok: false, code: "unavailable" } as const;

export function createPlayerPositionReader(auth: ReturnType<typeof createExtensionAuthPort>) {
  return async (ownerId: unknown, input: unknown, sender?: Sender): Promise<ApplicationResult<Position>> => {
    const panelUrl = browser.runtime.getURL("/sidepanel.html");
    if (!sender || sender.id !== browser.runtime.id || sender.url !== panelUrl
      || (sender.tab !== undefined && (!isObject(sender.tab) || sender.tab.url !== panelUrl)))
      return { ok: false, code: "forbidden" };
    if (!isObject(input) || Object.keys(input).length !== 1 || typeof input.videoId !== "string" || !/^[\w-]{11}$/.test(input.videoId))
      return { ok: false, code: "invalid" };
    const videoId = input.videoId;
    let expired = false, timer: ReturnType<typeof setTimeout>;
    const operation = async (): Promise<ApplicationResult<Position>> => {
      const current = await auth.accessToken();
      if (!current) return { ok: false, code: "unauthenticated" };
      if (current.session.userId !== ownerId) return { ok: false, code: "forbidden" };
      if (expired) return unavailable;
      const [before] = await browser.tabs.query({ active: true, currentWindow: true });
      if (expired || !before || !Number.isInteger(before.id) || watchId(before.url) !== videoId) return unavailable;
      if (!await auth.isCurrent(current.token)) return { ok: false, code: "forbidden" };
      if (expired) return unavailable;
      const reply: unknown = await browser.tabs.sendMessage(before.id!, { type: "BLUEPRINT_READ_PLAYER_POSITION", videoId }, { frameId: 0 });
      if (expired) return unavailable;
      const [after] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!await auth.isCurrent(current.token)) return { ok: false, code: "forbidden" };
      if (expired || after?.id !== before.id || after?.url !== before.url || watchId(after?.url) !== videoId) return unavailable;
      if (!isObject(reply) || Object.keys(reply).length !== 2 || reply.ok !== true || !isObject(reply.value)
        || Object.keys(reply.value).length !== 2 || reply.value.videoId !== videoId || !Number.isInteger(reply.value.positionSeconds)
        || typeof reply.value.positionSeconds !== "number" || reply.value.positionSeconds < 0 || reply.value.positionSeconds > 2147483647) return unavailable;
      return { ok: true, value: { videoId, positionSeconds: reply.value.positionSeconds } };
    };
    const deadline = new Promise<ApplicationResult<Position>>(resolve => { timer = setTimeout(() => { expired = true; resolve(unavailable); }, 3000); });
    try { return await Promise.race([operation().catch(() => unavailable), deadline]); }
    finally { clearTimeout(timer!); }
  };
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function watchId(raw: string | undefined): string | null {
  try {
    const url = new URL(raw ?? "");
    return url.origin === "https://www.youtube.com" && url.pathname === "/watch" && url.searchParams.getAll("v").length === 1 ? url.searchParams.get("v") : null;
  } catch { return null; }
}
