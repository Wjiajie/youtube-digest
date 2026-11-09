/** A bounded window of context, separate from the complete paginated account history. */
export function recentContext(
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    interrupted?: boolean;
  }>,
  limit = 18000,
) {
  const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
  let remaining = limit;
  for (const message of messages
    .filter((m) => !m.interrupted)
    .slice(-20)
    .reverse()) {
    if (remaining <= 0) break;
    const content = message.text.slice(0, Math.min(8000, remaining));
    remaining -= content.length;
    selected.push({ role: message.role, content });
  }
  return selected.reverse();
}
