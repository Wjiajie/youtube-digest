/** Shared by the Node voice gateway and Web server; no provider or database imports. */
export const contextBytes = (text: string) => new TextEncoder().encode(text).length;
export function fitContextText(text: string, bytes: number) {
  if (contextBytes(text) <= bytes) return text;
  let size = 0, result = "";
  for (const character of text) {
    size += contextBytes(character);
    if (size > bytes) break;
    result += character;
  }
  return result;
}
export function boundedToolResult(result: unknown, limit = 10000) {
  return contextBytes(JSON.stringify(result) ?? "null") <= limit ? result : {
    ok: false, code: "result_too_large",
    message: "结果过长，详情已保留在应用中；请查看确认卡或目标页面，不要假定操作已确认。",
  };
}

/** Keep tool-call/result pairs intact when an SDK tool loop grows unexpectedly. */
export function boundStepMessages<T extends { role: string; content: unknown }>(messages: T[], limit = 60000): T[] {
  if (contextBytes(JSON.stringify(messages)) <= limit) return messages;
  let user = messages.length - 1;
  while (user >= 0 && messages[user].role !== "user") user--;
  if (user < 0) return messages;
  let selected = messages.slice(user);
  if (contextBytes(JSON.stringify(selected)) <= limit) return selected;
  // Older completed tool rounds can be read again from authoritative tools.
  // The last assistant tool call and its result must travel together.
  if (selected.length > 3) selected = [selected[0], ...selected.slice(-2)];
  let remaining = 18000;
  return selected.map((message) => {
    if (message.role !== "tool" || !Array.isArray(message.content)) return message;
    return { ...message, content: message.content.map((part: any) => {
      const bytes = contextBytes(JSON.stringify(part.output) ?? "null");
      if (bytes <= remaining) { remaining -= bytes; return part; }
      return { ...part, output: { type: "json", value: boundedToolResult(part.output, 0) } };
    }) };
  });
}
