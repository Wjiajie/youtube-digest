import { describe, expect, it } from "vitest";
import {
  bridgeSignature,
  openTicket,
  sealTicket,
  verifyBridge,
  type GatewayTicket,
} from "./ticket";

const secret = "3a".repeat(32),
  otherSecret = "7b".repeat(32),
  now = 1_800_000_000_000;
const fixture: GatewayTicket = {
  ownerId: "47ea58e3-018d-450b-938e-d4aac5f418ef",
  conversationId: "230d4e35-0c6f-4275-8b5c-57ed5490ed39",
  accessToken: "user-session-sensitive-value",
  origin: "http://127.0.0.1:3000",
  nonce: "2ea42bab-5f44-4c97-a56d-e3f31e6d90bf",
  issuedAt: now,
  expiresAt: now + 60_000,
};

describe("encrypted companion gateway tickets", () => {
  it("round trips a scoped ticket without putting the user access token in plaintext", () => {
    const encrypted = sealTicket(fixture, secret);
    expect(openTicket(encrypted, secret, now)).toEqual(fixture);
    expect(
      Buffer.from(encrypted, "base64url").includes(
        Buffer.from(fixture.accessToken),
      ),
    ).toBe(false);
    expect(sealTicket(fixture, secret)).not.toBe(encrypted);
  });
  it("rejects ciphertext, IV and authentication-tag tampering or another key", () => {
    const encrypted = sealTicket(fixture, secret),
      bytes = Buffer.from(encrypted, "base64url");
    for (const position of [0, 12, 28, bytes.length - 1]) {
      const tampered = Buffer.from(bytes);
      tampered[position] ^= 1;
      expect(() =>
        openTicket(tampered.toString("base64url"), secret, now),
      ).toThrow();
    }
    expect(() => openTicket(encrypted, otherSecret, now)).toThrow();
  });
  it.each(["", "x", "not-a-ticket", "x".repeat(16_001)])(
    "rejects malformed or oversized envelopes: %s",
    (value) => {
      expect(() => openTicket(value, secret, now)).toThrow();
    },
  );
  it.each([
    { issuedAt: undefined },
    { issuedAt: null },
    { issuedAt: "1800000000000" },
    { issuedAt: Number.NaN },
    { expiresAt: undefined },
    { expiresAt: Number.POSITIVE_INFINITY },
    { expiresAt: now },
    { expiresAt: now - 1 },
    { issuedAt: now + 5001 },
    { expiresAt: now + 30 * 60_000 + 1 },
    { issuedAt: now + 100, expiresAt: now + 100 },
    { ownerId: true },
    { ownerId: "another-user" },
    { conversationId: {} },
    { nonce: "fixed-nonce" },
    { accessToken: 123 },
    { accessToken: "" },
    { accessToken: "x".repeat(12_001) },
    { origin: {} },
    { origin: "http://127.0.0.1:3000/path" },
    { origin: "invalid" },
  ])(
    "rejects malformed payload fields even when authenticated by the server key: %j",
    (patch) => {
      const encrypted = sealTicket(
        { ...fixture, ...patch } as unknown as GatewayTicket,
        secret,
      );
      expect(() => openTicket(encrypted, secret, now)).toThrow();
    },
  );
  it("accepts allowed clock skew and the maximum lifetime, but expires at its exact deadline", () => {
    expect(
      openTicket(
        sealTicket({ ...fixture, issuedAt: now + 5000 }, secret),
        secret,
        now,
      ).ownerId,
    ).toBe(fixture.ownerId);
    const value = { ...fixture, expiresAt: now + 30 * 60_000 };
    expect(openTicket(sealTicket(value, secret), secret, now)).toEqual(value);
    expect(() =>
      openTicket(sealTicket(value, secret), secret, value.expiresAt),
    ).toThrow();
  });
  it.each(["", "not-hex", "aa".repeat(31), "aa".repeat(33)])(
    "requires an exact 32-byte hexadecimal secret",
    (value) => {
      expect(() => sealTicket(fixture, value)).toThrow();
      expect(() => bridgeSignature("body", value)).toThrow();
    },
  );
});

describe("gateway-to-app request authentication", () => {
  it("binds the signature to the exact request bytes and independent gateway key", () => {
    const body = '{"type":"tools","ownerId":"owner"}',
      signature = bridgeSignature(body, secret);
    expect(verifyBridge(body, signature, secret)).toBe(true);
    expect(verifyBridge(`${body} `, signature, secret)).toBe(false);
    expect(
      verifyBridge(body.replace("owner", "attacker"), signature, secret),
    ).toBe(false);
    expect(verifyBridge(body, signature, otherSecret)).toBe(false);
    for (const value of ["", "a".repeat(63), "z".repeat(64), "A".repeat(64)])
      expect(verifyBridge(body, value, secret)).toBe(false);
  });
});
