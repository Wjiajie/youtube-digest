export function safeInternalPath(input: string | undefined): string {
  // Browsers normalize backslashes and strip control characters before
  // resolving a URL; a string that looks relative can become an external host.
  if (!input || !input.startsWith("/") || input.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(input)) return "/";
  return input;
}
