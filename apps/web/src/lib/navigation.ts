export function safeInternalPath(input: string | undefined): string {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return "/";
  return input;
}
