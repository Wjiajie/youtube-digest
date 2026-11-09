import { afterEach, describe, expect, it, vi } from "vitest";
import { localCompanionMode, loopbackHost } from "./local-config";

afterEach(() => vi.unstubAllEnvs());

describe("explicit local companion storage gate", () => {
  it("enables local identity only for explicit local storage in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLUEPRINT_COMPANION_STORAGE", "local");
    expect(localCompanionMode()).toBe(true);
  });
  it.each(["production", "test", "staging", ""])(
    "does not enable local identity in %s even with the local storage setting",
    (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv("BLUEPRINT_COMPANION_STORAGE", "local");
      expect(localCompanionMode()).toBe(false);
    },
  );
  it.each(["", "supabase", "cloud", "true", "LOCAL", " local "])(
    "does not silently replace hosted authentication for storage setting %j",
    (storage) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("BLUEPRINT_COMPANION_STORAGE", storage);
      expect(localCompanionMode()).toBe(false);
    },
  );
});

describe("loopback host boundary", () => {
  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3190",
    "[::1]",
    "[::1]:3000",
  ])("allows explicit loopback authority %s", (host) => {
    expect(loopbackHost(host)).toBe(true);
  });
  it.each([
    null,
    "",
    "blueprint.example",
    "blueprint.example:3000",
    "0.0.0.0",
    "192.168.1.10:3000",
    "10.0.0.1",
    "[::]",
    "localhost.attacker.test",
    "127.0.0.1.attacker.test",
    "attacker.test:127.0.0.1",
    "localhost@attacker.test",
    "127.0.0.1:3000@attacker.test",
    "https://localhost:3000",
    "localhost/path",
    "localhost:3000/path",
    "localhost:3000?host=127.0.0.1",
    "localhost:abc",
    "localhost:3000, attacker.test",
    " localhost",
    "localhost ",
  ])(
    "does not treat non-loopback or ambiguous authority %j as local authentication",
    (host) => {
      expect(loopbackHost(host)).toBe(false);
    },
  );
});
