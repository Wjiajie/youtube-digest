import { browser } from "wxt/browser";

const SESSION_KEY = "blueprint_cloud_session_v1";
const REQUEST_TIMEOUT_MS = 15_000;

export type ExtensionSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
};

export type AuthStatus = {
  connected: boolean;
  userId?: string;
  email?: string;
};

export function createExtensionAuthPort() {
  const supabaseUrl = requiredEnv(import.meta.env.WXT_PUBLIC_SUPABASE_URL, "WXT_PUBLIC_SUPABASE_URL");
  const clientId = requiredEnv(import.meta.env.WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID, "WXT_PUBLIC_EXTENSION_OAUTH_CLIENT_ID");
  const publishableKey = requiredEnv(import.meta.env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  let refreshing: { token: string; promise: Promise<ExtensionSession | null> } | undefined;
  let sessionEpoch = 0;
  let sessionMutations = Promise.resolve();

  function mutateSession<T>(operation: () => Promise<T>): Promise<T> {
    const result = sessionMutations.then(operation);
    sessionMutations = result.then(() => undefined, () => undefined);
    return result;
  }

  async function invalidate(token: string): Promise<void> {
    await mutateSession(async () => {
      const session = await readSession();
      if (session?.accessToken !== token) return;
      ++sessionEpoch;
      await browser.storage.local.remove([SESSION_KEY, `blueprint_cache:${session.userId}`, `blueprint_preferences:${session.userId}`]);
    });
  }

  async function refreshSession(previous: ExtensionSession): Promise<ExtensionSession | null> {
    const epoch = sessionEpoch;
    let session: ExtensionSession;
    try {
      session = await exchangeToken(`${supabaseUrl}/auth/v1/oauth/token`, {
        grant_type: "refresh_token", refresh_token: previous.refreshToken, client_id: clientId,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "AUTH_SESSION_EXPIRED") {
        await invalidate(previous.accessToken);
        return null;
      }
      // A transport/service failure can still display this session's offline
      // cache. Any authenticated HTTP request must validate the token again.
      await sessionMutations;
      return epoch === sessionEpoch && (await readSession())?.accessToken === previous.accessToken ? previous : null;
    }
    return mutateSession(async () => {
      if (epoch !== sessionEpoch || (await readSession())?.accessToken !== previous.accessToken || session.userId !== previous.userId) return null;
      await browser.storage.local.set({ [SESSION_KEY]: session });
      return epoch === sessionEpoch ? session : null;
    });
  }

  return {
    async isCurrent(token: string): Promise<boolean> {
      await sessionMutations;
      return (await readSession())?.accessToken === token;
    },

    invalidate,

    async status(): Promise<AuthStatus> {
      await sessionMutations;
      const session = await readSession();
      return session
        ? { connected: true, userId: session.userId, ...(session.email ? { email: session.email } : {}) }
        : { connected: false };
    },

    async connect(): Promise<AuthStatus> {
      const epoch = ++sessionEpoch;
      const verifier = randomBase64Url(64);
      const state = randomBase64Url(32);
      const challenge = await sha256Base64Url(verifier);
      const redirectUri = browser.identity.getRedirectURL("oauth2");
      const authorize = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "email",
      }).toString();

      const callback = await browser.identity.launchWebAuthFlow({ url: authorize.toString(), interactive: true });
      if (!callback) throw new Error("AUTH_CANCELLED");
      const callbackUrl = new URL(callback);
      if (callbackUrl.searchParams.get("state") !== state) throw new Error("AUTH_STATE_MISMATCH");
      const code = callbackUrl.searchParams.get("code");
      if (!code) throw new Error(callbackUrl.searchParams.get("error") || "AUTH_CODE_MISSING");
      const session = await exchangeToken(`${supabaseUrl}/auth/v1/oauth/token`, {
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      return mutateSession(async () => {
        if (epoch !== sessionEpoch) return { connected: false };
        const previous = await readSession();
        if (previous && previous.userId !== session.userId) {
          await browser.storage.local.remove([`blueprint_cache:${previous.userId}`, `blueprint_preferences:${previous.userId}`]);
        }
        await browser.storage.local.set({ [SESSION_KEY]: session });
        return epoch === sessionEpoch
          ? { connected: true, userId: session.userId, ...(session.email ? { email: session.email } : {}) }
          : { connected: false };
      });
    },

    async accessToken(): Promise<{ token: string; session: ExtensionSession } | null> {
      await sessionMutations;
      let session = await readSession();
      if (!session) return null;
      if (session.expiresAt <= Date.now() + 60_000) {
        if (refreshing?.token !== session.accessToken) {
          refreshing = { token: session.accessToken, promise: refreshSession(session) };
        }
        const pending = refreshing;
        try {
          session = await pending.promise;
        } finally {
          if (refreshing === pending) refreshing = undefined;
        }
      }
      return session ? { token: session.accessToken, session } : null;
    },

    async disconnect(): Promise<void> {
      // Invalidate in-flight authorization immediately, then remove the final
      // stored session after any already-started write has completed.
      ++sessionEpoch;
      const session = await mutateSession(async () => {
        const current = await readSession();
        if (current) await browser.storage.local.remove([SESSION_KEY, `blueprint_cache:${current.userId}`, `blueprint_preferences:${current.userId}`]);
        return current;
      });
      if (session) {
        await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}`, apikey: publishableKey },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }).catch(() => undefined);
      }
    },
  };
}

async function readSession(): Promise<ExtensionSession | null> {
  const stored = await browser.storage.local.get(SESSION_KEY);
  const session = stored[SESSION_KEY] as ExtensionSession | undefined;
  return session?.accessToken && session.refreshToken && session.userId ? session : null;
}

async function exchangeToken(endpoint: string, fields: Record<string, string>): Promise<ExtensionSession> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(fields.grant_type === "refresh_token" && (response.status === 400 || response.status === 401)
    ? "AUTH_SESSION_EXPIRED" : "AUTH_TOKEN_EXCHANGE_FAILED");
  const token = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const claims = decodeJwtPayload(token.access_token);
  const userId = typeof claims?.sub === "string" ? claims.sub : "";
  if (!userId) throw new Error("AUTH_SUBJECT_MISSING");
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    userId,
    ...(typeof claims?.email === "string" ? { email: claims.email } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
  } catch {
    return null;
  }
}

function randomBase64Url(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing extension environment variable: ${name}`);
  return value.replace(/\/$/, "");
}
