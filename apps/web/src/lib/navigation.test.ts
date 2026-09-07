import { describe, expect, it } from "vitest";

import { safeInternalPath } from "./navigation";

describe("safeInternalPath", () => {
  it("preserves local OAuth continuation paths", () => {
    expect(safeInternalPath("/oauth/consent?authorization_id=abc")).toBe(
      "/oauth/consent?authorization_id=abc",
    );
  });

  it("rejects absolute and protocol-relative redirects", () => {
    expect(safeInternalPath("https://attacker.example/path")).toBe("/");
    expect(safeInternalPath("//attacker.example/path")).toBe("/");
    expect(safeInternalPath("javascript:alert(1)")).toBe("/");
  });
});
