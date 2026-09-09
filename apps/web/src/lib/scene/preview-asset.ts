/** Only self-contained glTF JSON is accepted by the internal, local-file preview. */
export function validatePreviewAsset(text: string): void {
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) throw new Error("试装文件不能超过 10 MB。");
  const document = JSON.parse(text);
  if (document?.asset?.version !== "2.0") throw new Error("请选择 glTF 2.0 JSON 文件。");
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
