import { expect, test } from "vitest";
import { validatePreviewAsset } from "./preview-asset";

test("local preview rejects external resource references before a loader can request them", () => {
  for (const uri of ["https://example.com/model.bin", "../private.bin", "file:///private.bin"]) {
    expect(() => validatePreviewAsset(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri }] }))).toThrow("外部资源");
  }
});

test("preview accepts embedded glTF 2 but rejects malformed versions and oversized files", () => {
  expect(() => validatePreviewAsset('{"asset":{"version":"2.0"},"buffers":[{"uri":"data:application/octet-stream;base64,AAAA"}]}')).not.toThrow();
  expect(() => validatePreviewAsset('{"asset":{"version":"1.0"}}')).toThrow("glTF 2.0");
  expect(() => validatePreviewAsset(" ".repeat(10 * 1024 * 1024 + 1))).toThrow("10 MB");
});
