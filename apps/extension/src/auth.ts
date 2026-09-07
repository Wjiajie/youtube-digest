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

  return {
    async status(): Promise<AuthStatus> {
      const session = await readSession();
      return session
        ? { connected: true, userId: session.userId, ...(session.email ? { email: session.email } : {}) }
        : { connected: false };
    },

    async connect(): Promise<AuthStatus> {
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
      const previous = await readSession();
      if (previous && previous.userId !== session.userId) {
        await browser.storage.local.remove(`blueprint_cache:${previous.userId}`);
      }
      await browser.storage.local.set({ [SESSION_KEY]: session });
      return { connected: true, userId: session.userId, ...(session.email ? { email: session.email } : {}) };
    },

    async accessToken(): Promise<{ token: string; session: ExtensionSession } | null> {
      let session = await readSession();
      if (!session) return null;
      if (session.expiresAt <= Date.now() + 60_000) {
        session = await exchangeToken(`${supabaseUrl}/auth/v1/oauth/token`, {
          grant_type: "refresh_token",
          refresh_token: session.refreshToken,
          client_id: clientId,
        });
        await browser.storage.local.set({ [SESSION_KEY]: session });
      }
      return { token: session.accessToken, session };
    },

    async disconnect(): Promise<void> {
      const session = await readSession();
      if (session) {
        await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}`, apikey: publishableKey },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }).catch(() => undefined);
      }
      await browser.storage.local.remove(SESSION_KEY);
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
  if (!response.ok) throw new Error("AUTH_TOKEN_EXCHANGE_FAILED");
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
