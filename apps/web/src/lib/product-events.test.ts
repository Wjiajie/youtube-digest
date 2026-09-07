import { describe, expect, it, vi } from "vitest";

import { recordProductEvent } from "./product-events";

describe("product event boundary", () => {
  it("never turns a successful product action into a failure", async () => {
    const insert = vi.fn(async () => {
      throw new Error("analytics unavailable");
    });
    const client = { from: vi.fn(() => ({ insert })) } as any;

    await expect(recordProductEvent(
      client,
      { userId: "018f6f68-9b4d-7c93-a134-c8571b8f7701", client: "web" },
      "proposal_applied",
    )).resolves.toBeUndefined();
  });
});
