export function loadPromptSection(
  markdown: string,
  heading: string,
  variables: Record<string, unknown> = {},
): string {
  const marker = `## ${heading}`;
  const markerIndex = markdown.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Prompt section not found: ${heading}`);
  }
  const sectionStart = markerIndex + marker.length;
  const nextSection = markdown.indexOf("\n## ", sectionStart);
  const section = markdown.slice(
    sectionStart,
    nextSection === -1 ? markdown.length : nextSection,
  );
  const fenceMatch = section.match(
    /```(?:[A-Za-z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```/,
  );
  if (!fenceMatch) throw new Error(`Prompt section not found: ${heading}`);

  const prompt = fenceMatch[1].replace(/\{([A-Za-z0-9_]+)\}/g, (token, key) =>
    Object.hasOwn(variables, key) ? String(variables[key] ?? "") : token,
  );
  if (prompt.length > 1_000_000) {
    throw new Error("Rendered Agent prompt is too large");
  }
  return prompt;
}

export function parseLooseJson(text: string): unknown {
  let normalized = String(text || "").trim();
  normalized = normalized.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    normalized = normalized.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return JSON.parse(normalized.replace(/,\s*([}\]])/g, "$1"));
  }
}
