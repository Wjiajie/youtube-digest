/** Only self-contained glTF JSON / GLB is accepted by the local-file preview. */
export function validatePreviewAsset(data: string | ArrayBuffer): void {
  const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
  if (size > 10 * 1024 * 1024) throw new Error("试装文件不能超过 10 MB。");
  const document = JSON.parse(typeof data === "string" ? data : glbJson(data));
  if (document?.asset?.version !== "2.0") throw new Error("请选择 glTF 2.0 或 GLB 2.0 文件。");
  const pending: unknown[] = [document];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "uri" && (typeof entry !== "string" || !entry.startsWith("data:"))) {
        throw new Error("试装仅接受内嵌资源，不能读取外部资源。");
      }
      if (entry && typeof entry === "object") pending.push(entry);
    }
  }
}

function glbJson(data: ArrayBuffer): string {
  const invalid = () => new Error("GLB 文件头、长度或数据块无效。");
  if (data.byteLength < 20) throw invalid();
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== data.byteLength) throw invalid();
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length % 4 !== 0
    || 20 + length > data.byteLength) throw invalid();
  const binaryOffset = 20 + length;
  if (binaryOffset < data.byteLength) {
    if (binaryOffset + 8 > data.byteLength) throw invalid();
    const binaryLength = view.getUint32(binaryOffset, true);
    // This internal preview supports one JSON chunk and an optional BIN chunk.
    // Never let the loader select a different JSON document than the one checked.
    if (view.getUint32(binaryOffset + 4, true) !== 0x004e4942 || binaryLength % 4 !== 0
      || binaryOffset + 8 + binaryLength !== data.byteLength) throw invalid();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(data, 20, length));
}
