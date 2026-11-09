import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export type GatewayTicket = {
  ownerId: string;
  conversationId: string;
  accessToken: string;
  origin: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};
function key(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new Error("Gateway secret must be 32 bytes of hex");
  return Buffer.from(secret, "hex");
}
export function sealTicket(value: GatewayTicket, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function openTicket(
  value: string,
  secret: string,
  now = Date.now(),
): GatewayTicket {
  if (value.length > 16000) throw new Error("Invalid ticket");
  const packed = Buffer.from(value, "base64url");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    packed.subarray(0, 12),
  );
  cipher.setAuthTag(packed.subarray(12, 28));
  const result = JSON.parse(
    Buffer.concat([
      cipher.update(packed.subarray(28)),
      cipher.final(),
    ]).toString("utf8"),
  );
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (
    ![result.ownerId, result.conversationId, result.nonce].every(
      (v) => typeof v === "string" && uuid.test(v),
    ) ||
    typeof result.accessToken !== "string" ||
    !result.accessToken ||
    result.accessToken.length > 12000 ||
    typeof result.origin !== "string" ||
    !URL.canParse(result.origin) ||
    new URL(result.origin).origin !== result.origin ||
    !Number.isFinite(result.issuedAt) ||
    !Number.isFinite(result.expiresAt) ||
    result.expiresAt <= now ||
    result.issuedAt > now + 5000 ||
    result.expiresAt <= result.issuedAt ||
    result.expiresAt - result.issuedAt > 30 * 60_000
  )
    throw new Error("Expired or invalid ticket");
  return result;
}
export function bridgeSignature(body: string, secret: string) {
  return createHmac("sha256", key(secret)).update(body).digest("hex");
}
export function verifyBridge(body: string, signature: string, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(bridgeSignature(body, secret), "hex"),
  );
}
